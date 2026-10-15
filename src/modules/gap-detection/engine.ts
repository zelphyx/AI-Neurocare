import crypto from 'node:crypto';
import {
  MANDATORY_GAP_DISCLAIMER,
  REQUIRED_SCREENING_PARAMETERS,
  SEVERITY_WEIGHTS,
  isPhysiologicallyValid,
  resolveValidityWindow,
  getActionableRecommendation,
  getDefaultSeverity,
} from './constants.js';
import {
  validateScreeningGapRequest,
  validateScreeningGapResponse,
} from './validators.js';
import type {
  ScreeningGapResponse,
  ScreeningGapItem,
  GapType,
  GapSeverity,
  HighestSeverity,
  OverallComplianceStatus,
  ScreeningRecordItem,
} from './types.js';

export interface DetectGapsOptions {
  instance?: string;
  reportId?: string;
}

/**
 * Calculates calendar day difference between two dates in UTC
 * Returns positive integer when recordDate is in the past relative to evalDate
 */
function calculateDaysDifference(recordDate: Date, evalDate: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  const utcRecord = Date.UTC(
    recordDate.getUTCFullYear(),
    recordDate.getUTCMonth(),
    recordDate.getUTCDate()
  );
  const utcEval = Date.UTC(
    evalDate.getUTCFullYear(),
    evalDate.getUTCMonth(),
    evalDate.getUTCDate()
  );
  return Math.floor((utcEval - utcRecord) / msPerDay);
}

/**
 * 100% Deterministic Screening Gap Detection Engine (MOD-02)
 * Evaluates patient screening records against Kemenkes RI / SATUSEHAT 5-Pillar Guidelines.
 * Strictly adheres to Zero Disease Inference principle from missing/stale fields.
 */
export function detectScreeningGaps(
  rawInput: unknown,
  options?: DetectGapsOptions
): ScreeningGapResponse {
  const instance = options?.instance ?? '/api/v1/screening/gaps';

  // Step 1: Validate input request schema
  const request = validateScreeningGapRequest(rawInput, instance);

  const evalDate = request.evaluationDate
    ? new Date(request.evaluationDate)
    : new Date();

  const identifiedGaps: ScreeningGapItem[] = [];

  // Step 2: Loop across all 6 standard required PTM parameters
  for (const metadata of REQUIRED_SCREENING_PARAMETERS) {
    const paramCode = metadata.parameterCode;

    // Find the matching screening record in the request
    const record: ScreeningRecordItem | undefined = request.screeningRecords.find(
      (r) => r.parameterCode === paramCode
    );

    // KASUS 1: Parameter Belum Pernah Ada Sama Sekali (Never Performed)
    if (!record || record.recordedAt === null || record.recordedAt === undefined) {
      const gapType: GapType = 'NEVER_PERFORMED';
      const severity: GapSeverity = getDefaultSeverity(paramCode, gapType);
      const validityWindowDays = resolveValidityWindow(
        paramCode,
        null,
        request.knownRiskProfile
      );

      identifiedGaps.push({
        parameterCode: paramCode,
        parameterName: metadata.parameterName,
        pillarName: metadata.pillarName,
        gapType,
        severity,
        daysSinceLastRecorded: null,
        validityWindowDays,
        recordedValue: null,
        actionableRecommendation: getActionableRecommendation(paramCode, gapType),
      });
      continue;
    }

    // KASUS 2: Data Kosong dalam Transaksi (Missing Data)
    if (record.recordedValue === null || record.recordedValue === undefined) {
      const gapType: GapType = 'MISSING_DATA';
      const severity: GapSeverity = 'HIGH';
      const validityWindowDays = resolveValidityWindow(
        paramCode,
        null,
        request.knownRiskProfile
      );

      identifiedGaps.push({
        parameterCode: paramCode,
        parameterName: metadata.parameterName,
        pillarName: metadata.pillarName,
        gapType,
        severity,
        daysSinceLastRecorded: null,
        validityWindowDays,
        recordedValue: null,
        actionableRecommendation: getActionableRecommendation(paramCode, gapType),
      });
      continue;
    }

    const recordDate = new Date(record.recordedAt);

    // KASUS 3: Stempel Waktu Masa Depan (Clock Skew / Future Timestamp -> Invalid Data)
    if (recordDate.getTime() > evalDate.getTime()) {
      const gapType: GapType = 'INVALID_DATA';
      const severity: GapSeverity = 'CRITICAL';
      const validityWindowDays = resolveValidityWindow(
        paramCode,
        record.recordedValue,
        request.knownRiskProfile
      );

      identifiedGaps.push({
        parameterCode: paramCode,
        parameterName: metadata.parameterName,
        pillarName: metadata.pillarName,
        gapType,
        severity,
        daysSinceLastRecorded: 0,
        validityWindowDays,
        recordedValue: record.recordedValue,
        actionableRecommendation: getActionableRecommendation(paramCode, gapType),
      });
      continue;
    }

    // KASUS 4: Data Tidak Masuk Akal / Di Luar Batas Biologis (Invalid Data)
    if (!isPhysiologicallyValid(paramCode, record.recordedValue)) {
      const gapType: GapType = 'INVALID_DATA';
      const severity: GapSeverity = 'CRITICAL';
      const daysDiff = calculateDaysDifference(recordDate, evalDate);
      const validityWindowDays = resolveValidityWindow(
        paramCode,
        record.recordedValue,
        request.knownRiskProfile
      );

      identifiedGaps.push({
        parameterCode: paramCode,
        parameterName: metadata.parameterName,
        pillarName: metadata.pillarName,
        gapType,
        severity,
        daysSinceLastRecorded: daysDiff,
        validityWindowDays,
        recordedValue: record.recordedValue,
        actionableRecommendation: getActionableRecommendation(paramCode, gapType),
      });
      continue;
    }

    // KASUS 5: Pengecekan Masa Laku Klinis (Stale Data Check)
    const daysDiff = calculateDaysDifference(recordDate, evalDate);
    const validityWindowDays = resolveValidityWindow(
      paramCode,
      record.recordedValue,
      request.knownRiskProfile
    );

    if (daysDiff > validityWindowDays) {
      const gapType: GapType = 'STALE_DATA';
      const severity: GapSeverity = getDefaultSeverity(paramCode, gapType);

      identifiedGaps.push({
        parameterCode: paramCode,
        parameterName: metadata.parameterName,
        pillarName: metadata.pillarName,
        gapType,
        severity,
        daysSinceLastRecorded: daysDiff,
        validityWindowDays,
        recordedValue: record.recordedValue,
        actionableRecommendation: getActionableRecommendation(paramCode, gapType),
      });
    }
    // Jika daysDiff <= validityWindowDays dan physiologically valid -> Parameter Segar & Lengkap (No Gap)
  }

  // Step 3: Sort identified gaps by severity descending (CRITICAL -> HIGH -> MEDIUM -> LOW)
  identifiedGaps.sort((a, b) => SEVERITY_WEIGHTS[b.severity] - SEVERITY_WEIGHTS[a.severity]);

  // Step 4: Determine Highest Severity
  let highestSeverity: HighestSeverity = 'NONE';
  for (const gap of identifiedGaps) {
    if (SEVERITY_WEIGHTS[gap.severity] > SEVERITY_WEIGHTS[highestSeverity]) {
      highestSeverity = gap.severity;
    }
  }

  // Step 5: Calculate Overall Compliance Status
  let overallComplianceStatus: OverallComplianceStatus;
  const totalEvaluated = REQUIRED_SCREENING_PARAMETERS.length; // 6
  const activeGapsCount = identifiedGaps.length;

  if (activeGapsCount === 0) {
    overallComplianceStatus = 'FULLY_COMPLIANT';
  } else if (highestSeverity === 'CRITICAL') {
    overallComplianceStatus = 'ACTION_REQUIRED_CRITICAL';
  } else if (activeGapsCount >= 4) {
    // 4 or more gaps out of 6 parameters indicate non-compliance with the screening protocol
    overallComplianceStatus = 'NON_COMPLIANT';
  } else {
    overallComplianceStatus = 'PARTIALLY_COMPLIANT';
  }

  // Step 6: Construct and validate response object
  const response: ScreeningGapResponse = {
    reportId: options?.reportId ?? crypto.randomUUID(),
    patientId: request.patientId,
    evaluationDate: evalDate.toISOString(),
    overallComplianceStatus,
    totalParametersEvaluated: totalEvaluated,
    activeGapsCount,
    highestSeverity,
    identifiedGaps,
    clinicalDisclaimer: MANDATORY_GAP_DISCLAIMER,
  };

  return validateScreeningGapResponse(response);
}
