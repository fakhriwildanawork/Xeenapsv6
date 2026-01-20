import re
import requests
from flask import Flask, request, jsonify

app = Flask(__name__)

# Primary and Secondary Piped API instances for fast stream extraction
PIPED_INSTANCES = [
    "https://pipedapi.kavin.rocks",
    "https://pa.il.ax"
]

def get_audio_stream_url(video_id):
    """
    Rapidly fetches direct audio stream URL from Piped API instances.
    Strict timeout of 2.5s per instance to ensure response within < 5s total.
    """
    for base_url in PIPED_INSTANCES:
        try:
            # Request stream data from Piped API
            api_url = f"{base_url}/streams/{video_id}"
            resp = requests.get(api_url, timeout=2.5)
            
            if resp.status_code == 200:
                data = resp.json()
                audio_streams = data.get('audioStreams', [])
                
                if audio_streams:
                    # Sort by bitrate descending and prefer m4a if possible
                    m4a_streams = [s for s in audio_streams if 'audio/mp4' in s.get('mimeType', '')]
                    if m4a_streams:
                        return m4a_streams[0].get('url')
                    
                    # Fallback to the first available audio stream (usually opus/webm)
                    return audio_streams[0].get('url')
        except Exception as e:
            print(f"Piped instance {base_url} failed or timed out: {str(e)}")
            continue
            
    return None

@app.route('/api/extract', methods=['POST'])
def extract():
    try:
        if not request.is_json:
            return jsonify({"status": "error", "message": "Content-Type must be application/json"}), 400
            
        data = request.get_json()
        url = data.get('url')
        
        if not url:
            return jsonify({"status": "error", "message": "URL is required"}), 400
            
        # Extract Video ID from various YouTube URL formats
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
                return jsonify({"status": "error", "message": "Could not extract audio stream within timeout limits."}), 500
        
        return jsonify({"status": "error", "message": "Invalid YouTube URL format."}), 400
        
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

if __name__ == '__main__':
    app.run(port=5000)