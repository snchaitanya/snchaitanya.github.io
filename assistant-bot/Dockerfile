FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Persist the SQLite DB outside the image layer when possible (mount a
# volume at /app/data and set DB_PATH=/app/data/assistant.db).
VOLUME ["/app/data"]

CMD ["python", "bot.py"]
