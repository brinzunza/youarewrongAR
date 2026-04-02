from flask import Flask, render_template
from flask_socketio import SocketIO, emit
from openai import OpenAI
import os
import json
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

app = Flask(__name__)
app.config['SECRET_KEY'] = 'youarewrong_secret_key'
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

# Initialize OpenAI
api_key = os.getenv('OPENAI_API_KEY')
if not api_key:
    print("Warning: OPENAI_API_KEY not found in .env file")
    client = None
else:
    try:
        client = OpenAI(api_key=api_key)
        print("OpenAI client initialized successfully")
    except Exception as e:
        print(f"OpenAI client initialization failed: {e}")
        client = None

def get_ai_counterargument(statement):
    """Get AI fact-check and counterargument in JSON format"""
    if not client:
        return json.dumps({
            "text": statement,
            "truth": False,
            "counterargument": "OpenAI client not available. Check API key configuration."
        })

    try:
        prompt = f"""Analyze the following statement for factual accuracy.
Statement: "{statement}"

Respond ONLY with a JSON object in this EXACT format:
{{
  "text": "the original statement",
  "truth": true or false,
  "counterargument": "a concise (max 60 words) factual counter-point with evidence"
}}

Rules:
1. "truth" must be a boolean (true if the statement is factually accurate, false otherwise).
2. "counterargument" should be direct, factual, and provide a clear counter if the statement is false.
3. If the statement is true, provide supporting context in the "counterargument" field.
4. Do not include any text other than the JSON object."""

        response = client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {"role": "system", "content": "You are a factual analyzer who responds only in JSON format."},
                {"role": "user", "content": prompt}
            ],
            max_tokens=200,
            temperature=0.3,
            response_format={ "type": "json_object" }
        )

        return response.choices[0].message.content.strip()

    except Exception as e:
        print(f"OpenAI API error: {e}")
        return json.dumps({
            "text": statement,
            "truth": False,
            "counterargument": f"Unable to fact-check at this time. Error: {str(e)}"
        })

@app.route('/')
def index():
    return render_template('index.html')

@socketio.on('speech_detected')
def handle_speech(data):
    """Handle speech recognition from client"""
    try:
        statement = data.get('statement', '')
        print(f"Received statement: {statement}")

        if statement and len(statement.split()) >= 3:
            emit('ai_processing', {'status': 'processing'})
            
            # Get AI response (already a JSON string from the helper)
            ai_json_str = get_ai_counterargument(statement)
            
            try:
                ai_data = json.loads(ai_json_str)
                emit('ai_response', ai_data)
            except json.JSONDecodeError:
                emit('ai_response', {
                    "text": statement,
                    "truth": False,
                    "counterargument": "Error parsing AI response."
                })
        else:
            emit('ai_response', {
                "text": statement,
                "truth": True,
                "counterargument": "Statement too short to analyze."
            })

    except Exception as e:
        print(f"Error processing speech: {e}")
        emit('ai_response', {
            "text": data.get('statement', ''),
            "truth": False,
            "counterargument": "Error processing your statement."
        })

@socketio.on('connect')
def handle_connect():
    print('Client connected')
    emit('status', {'msg': 'Connected to YouAreWrong server'})

@socketio.on('disconnect')
def handle_disconnect():
    print('Client disconnected')

if __name__ == '__main__':
    port = 5001
    socketio.run(app, debug=True, host='0.0.0.0', port=port,
                 allow_unsafe_werkzeug=True,
                 ssl_context=('cert.pem', 'key.pem'))
