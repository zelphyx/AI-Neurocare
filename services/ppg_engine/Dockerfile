# PPG Engine (FastAPI DSP microservice)
# Build:  docker build -t ppg-engine .
# Run:    docker run -p 8001:8001 ppg-engine
FROM python:3.12-slim
WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py core.py schemas.py ./
COPY dsp ./dsp

EXPOSE 8001
USER nobody
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8001/health')" || exit 1
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8001"]
