class App {
    constructor() {
        this.socket = io();
        this.recognition = null;
        this.faceMesh = null;
        this.isListening = false;

        this.video = document.getElementById('video');
        this.canvas = document.getElementById('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.status = document.getElementById('status');
        this.border = document.getElementById('border');
        this.conversation = document.getElementById('conversation');
        this.toggleBtn = document.getElementById('toggleBtn');
        this.clearBtn = document.getElementById('clearBtn');
        this.loading = document.getElementById('loading');

        this.init();
    }

    async init() {
        this.setupSocket();
        this.setupControls();
        await this.setupCamera();
        this.setupFaceMesh();
        this.setupSpeech();
    }

    setupSocket() {
        this.socket.on('ai_processing', () => {
            this.showLoading();
            this.updateStatus('PROCESSING');
            this.updateBorder('processing');
        });

        this.socket.on('ai_response', (data) => {
            this.hideLoading();
            this.displayResponse(data.statement, data.response);
            this.updateStatus('RESPONSE');
            this.updateBorder('response');
        });
    }

    setupControls() {
        this.toggleBtn.onclick = () => this.toggle();
        this.clearBtn.onclick = () => this.clear();
        window.onresize = () => this.resizeCanvas();
    }

    async setupCamera() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
                audio: false
            });
            this.video.srcObject = stream;
            this.video.onloadedmetadata = () => this.resizeCanvas();
        } catch (error) {
            console.error('Camera error:', error);
            this.updateStatus('CAMERA ERROR');
        }
    }

    setupFaceMesh() {
        this.faceMesh = new FaceMesh({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
        });

        this.faceMesh.setOptions({
            maxNumFaces: 1,
            refineLandmarks: true,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });

        this.faceMesh.onResults((results) => this.onFaceResults(results));

        const camera = new Camera(this.video, {
            onFrame: async () => await this.faceMesh.send({ image: this.video }),
            width: 640,
            height: 480
        });
        camera.start();
    }

    setupSpeech() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            this.updateStatus('SPEECH NOT SUPPORTED');
            return;
        }

        this.recognition = new SpeechRecognition();
        this.recognition.continuous = true;
        this.recognition.interimResults = false;
        this.recognition.lang = 'en-US';

        this.recognition.onresult = (event) => {
            const result = event.results[event.results.length - 1];
            if (result.isFinal) {
                const text = result[0].transcript.trim();
                if (text.split(' ').length >= 3) {
                    this.socket.emit('speech_detected', { statement: text });
                }
            }
        };

        this.recognition.onerror = (event) => {
            if (event.error === 'not-allowed') {
                this.updateStatus('MIC DENIED');
                this.isListening = false;
                this.toggleBtn.textContent = 'START';
            }
        };

        this.recognition.onend = () => {
            if (this.isListening) {
                setTimeout(() => {
                    if (this.isListening) this.recognition.start();
                }, 100);
            }
        };
    }

    onFaceResults(results) {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        if (results.multiFaceLandmarks?.[0]) {
            const landmarks = results.multiFaceLandmarks[0];
            this.drawMouth(landmarks);

            const ratio = this.getMouthRatio(landmarks);
            if (this.isListening && ratio > 0.02) {
                this.updateStatus('TALKING');
                this.updateBorder('talking');
            } else if (this.isListening) {
                this.updateStatus('LISTENING');
                this.updateBorder('listening');
            }
        }
    }

    drawMouth(landmarks) {
        const mouthIndices = [61, 146, 91, 181, 84, 17, 314, 405, 320, 307, 375, 321, 308, 324, 318];

        this.ctx.strokeStyle = '#0ff';
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();

        mouthIndices.forEach((idx, i) => {
            const point = landmarks[idx];
            const x = point.x * this.canvas.width;
            const y = point.y * this.canvas.height;
            i === 0 ? this.ctx.moveTo(x, y) : this.ctx.lineTo(x, y);
        });

        this.ctx.closePath();
        this.ctx.stroke();
    }

    getMouthRatio(landmarks) {
        const top = landmarks[13];
        const bottom = landmarks[14];
        const left = landmarks[61];
        const right = landmarks[291];

        const vDist = Math.hypot(
            (top.x - bottom.x) * this.canvas.width,
            (top.y - bottom.y) * this.canvas.height
        );

        const hDist = Math.hypot(
            (left.x - right.x) * this.canvas.width,
            (left.y - right.y) * this.canvas.height
        );

        return hDist > 0 ? vDist / hDist : 0;
    }

    toggle() {
        if (!this.recognition) return;

        if (this.isListening) {
            this.isListening = false;
            this.recognition.stop();
            this.toggleBtn.textContent = 'START';
            this.updateStatus('STOPPED');
            this.updateBorder('');
        } else {
            this.isListening = true;
            this.recognition.start();
            this.toggleBtn.textContent = 'STOP';
            this.updateStatus('LISTENING');
            this.updateBorder('listening');
        }
    }

    displayResponse(statement, response) {
        this.conversation.innerHTML = `
            <div class="message user-msg">
                <div class="label">You</div>
                <div class="text">"${statement}"</div>
            </div>
            <div class="message ai-msg">
                <div class="label">AI</div>
                <div class="text">${response}</div>
            </div>
        `;
    }

    clear() {
        this.conversation.innerHTML = '<p class="hint">Say something to get started</p>';
    }

    updateStatus(text) {
        this.status.textContent = text;
    }

    updateBorder(state) {
        this.border.className = state;
    }

    showLoading() {
        this.loading.classList.remove('hidden');
    }

    hideLoading() {
        this.loading.classList.add('hidden');
    }

    resizeCanvas() {
        const rect = this.video.getBoundingClientRect();
        this.canvas.width = rect.width;
        this.canvas.height = rect.height;
    }
}

document.addEventListener('DOMContentLoaded', () => new App());
