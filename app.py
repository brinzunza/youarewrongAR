from flask import Flask, render_template
from flask_socketio import SocketIO, emit
from openai import OpenAI
import os
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
    """Get AI fact-check and counterargument"""
    if not client:
        return f"Truth: unknown\nCounter: OpenAI client not available. Check API key configuration."

    try:
        prompt = f"""You are a fact-checker. Someone just said: "{statement}"

Please respond in EXACTLY this format:
Truth: [true or false]
Counter: [a simple and concise counter to their main arguments and their supporting facts]

Rules:
1. For "Truth:" - Simply state "true" or "false" based on factual accuracy
2. For "Counter:" - Provide a brief, factual counterargument with supporting evidence
3. Keep the entire response under 80 words
4. Be direct and factual, not humorous
5. Focus on verifiable facts and logical reasoning

Statement to analyze: "{statement}\""""

        response = client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {"role": "system", "content": "You are a factual analyzer who responds in the exact format: Truth: [true/false], Counter: [brief factual counter with evidence]."},
                {"role": "user", "content": prompt}
            ],
            max_tokens=120,
            temperature=0.3
        )

        return response.choices[0].message.content.strip()

    except Exception as e:
        print(f"OpenAI API error: {e}")
        return f"Truth: unknown\nCounter: Unable to fact-check '{statement}' at this time. Error: {str(e)}"

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
            # Emit processing status
            emit('ai_processing', {'status': 'processing'})

            # Get AI response
            ai_response = get_ai_counterargument(statement)

            # Send response back to client
            emit('ai_response', {
                'statement': statement,
                'response': ai_response
            })
        else:
            emit('ai_response', {
                'statement': statement,
                'response': 'Statement too short to analyze.'
            })

    except Exception as e:
        print(f"Error processing speech: {e}")
        emit('ai_response', {
            'statement': data.get('statement', ''),
            'response': 'Error processing your statement.'
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
    print("\n" + "="*50)
    print("🤖 You Are Wrong AR")
    print("="*50)
    print(f"Access: http://localhost:{port}")
    print("="*50 + "\n")

    socketio.run(app, debug=True, host='0.0.0.0', port=port, allow_unsafe_werkzeug=True)