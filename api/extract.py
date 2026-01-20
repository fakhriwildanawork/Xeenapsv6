import re
import requests
from flask import Flask, request, jsonify

app = Flask(__name__)

# Daftar instansi Piped yang reliabel dan cepat
PIPED_INSTANCES = [
    "https://pipedapi.kavin.rocks",
    "https://pa.il.ax"
]

def get_audio_stream_url(video_id):
    """
    Mengambil URL stream audio langsung dari Piped API.
    Timeout 2.5s per instansi (Total < 5s untuk 2 instansi).
    """
    for base_url in PIPED_INSTANCES:
        try:
            api_url = f"{base_url}/streams/{video_id}"
            # Timeout ketat 2.5 detik sesuai permintaan
            resp = requests.get(api_url, timeout=2.5)
            
            if resp.status_code == 200:
                data = resp.json()
                audio_streams = data.get('audioStreams', [])
                
                if audio_streams:
                    # Mencari format m4a/mp4 untuk kompatibilitas terbaik dengan Whisper
                    m4a_streams = [s for s in audio_streams if 'audio/mp4' in s.get('mimeType', '')]
                    if m4a_streams:
                        return m4a_streams[0].get('url')
                    
                    # Fallback ke audio stream pertama jika m4a tidak ada
                    return audio_streams[0].get('url')
        except Exception as e:
            print(f"Piped instance {base_url} failed: {str(e)}")
            continue
            
    return None

@app.route('/api/extract', methods=['POST'])
def extract():
    try:
        if not request.is_json:
            return jsonify({"status": "error", "message": "JSON required"}), 400
            
        data = request.get_json()
        url = data.get('url')
        
        if not url:
            return jsonify({"status": "error", "message": "URL required"}), 400
            
        # Regex untuk mengekstrak Video ID dari berbagai format URL YouTube
        video_id = ""
        if 'youtu.be/' in url:
            video_id = url.split('/')[-1].split('?')[0]
        else:
            match = re.search(r'v=([^&]+)', url)
            video_id = match.group(1) if match else ""

        if video_id:
            stream_url = get_audio_stream_url(video_id)
            if stream_url:
                return jsonify({
                    "status": "success",
                    "stream_url": stream_url,
                    "video_id": video_id
                })
            else:
                return jsonify({"status": "error", "message": "Piped instances timed out or failed."}), 504
        
        return jsonify({"status": "error", "message": "Invalid YouTube URL."}), 400
        
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

if __name__ == '__main__':
    app.run(port=5000)