#!/bin/bash
# Start the Sybil Image Generation Service
# Requires: Python 3.10+, pip install -r requirements.txt

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Create output directory
mkdir -p output

# Check for virtual env
if [ -d "venv" ]; then
    source venv/bin/activate
fi

echo "Starting Sybil Image Service on port 8100..."
python server.py
