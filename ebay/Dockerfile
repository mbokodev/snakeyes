FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    TZ=America/Toronto \
    EBAY_DATA_DIR=/data

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY ebay_auth.py scrapper.py kijiji_scrapper.py run.sh ./
COPY configs/ ./configs/
RUN sed -i 's/\r$//' run.sh && chmod +x run.sh && mkdir -p /data

VOLUME ["/data"]

CMD ["./run.sh"]
