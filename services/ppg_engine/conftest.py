"""Pytest bootstrap: expose the ppg_engine package on sys.path."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
