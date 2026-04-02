class App {
    constructor() {
        this.socket = io();
        this.recognition = null;
        this.faceMesh = null;
        this.isListening = false;
        this.stream = null;
        this.animationId = null;
        
        // Mobile starting on back camera
        this.isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        this.currentFacingMode = this.isMobile ? 'environment' : 'user';

        // Dev mode check from URL
        const urlParams = new URLSearchParams(window.location.search);
        this.isDevMode = urlParams.get('dev') === 'true';

        this.video = document.getElementById('video');
        this.canvas = document.getElementById('canvas');
        this.ctx = this.canvas.getContext('2d');
        
        // UI Elements
        this.status = document.getElementById('status');
        this.border = document.getElementById('border');
        this.overlay = document.getElementById('conversation-overlay');
        this.toggleBtn = document.getElementById('toggleBtn');
        this.switchBtn = document.getElementById('switchBtn');
        this.loading = document.getElementById('loading');
        
        this.selectedFaceIndex = 0;
        this.multiFaceLandmarks = [];

        if (this.isDevMode) {
            document.body.classList.add('dev-mode');
            this.status.classList.remove('hidden');
        }

        this.init();
    }

    async init() {
        this.setupSocket();
        this.setupControls();
        this.setupFaceMesh();
        await this.setupCamera();
        this.setupSpeech();

        if (this.isMobile) {
            this.switchBtn.classList.remove('hidden');
        }

        // Tap to readjust person
        this.canvas.addEventListener('click', (e) => this.handleCanvasClick(e));
        this.canvas.style.pointerEvents = 'auto';
    }

    setupSocket() {
        this.socket.on('ai_processing', () => {
            this.showLoading();
            this.updateStatus('PROCESSING');
            this.updateBorder('processing');
        });

        this.socket.on('ai_response', (data) => {
            this.hideLoading();
            this.displayOverlayResponse(data);
            this.updateStatus('RESPONSE');
            this.updateBorder('response');
        });
    }

    setupControls() {
        this.toggleBtn.onclick = () => this.toggle();
        this.switchBtn.onclick = () => this.switchCamera();
        window.onresize = () => this.resizeCanvas();
    }

    async setupCamera() {
        try {
            // Stop any existing stream and animation
            if (this.stream) {
                this.stream.getTracks().forEach(track => track.stop());
            }
            if (this.animationId) {
                cancelAnimationFrame(this.animationId);
            }

            const constraints = {
                video: { 
                    facingMode: this.currentFacingMode,
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                },
                audio: false
            };

            this.stream = await navigator.mediaDevices.getUserMedia(constraints);
            this.video.srcObject = this.stream;
            
            // Mirror only selfie camera
            const isUser = this.currentFacingMode === 'user' || 
                          (this.stream.getVideoTracks()[0].getSettings().facingMode === 'user');
            
            const transform = isUser ? 'scaleX(-1)' : 'scaleX(1)';
            this.video.style.transform = transform;
            this.canvas.style.transform = transform;

            this.video.onloadedmetadata = () => {
                this.resizeCanvas();
                this.video.play();
                this.startProcessingLoop();
            };
        } catch (error) {
            console.error('Camera error:', error);
            this.updateStatus('CAMERA ERROR');
            // Fallback if environment fails
            if (this.currentFacingMode === 'environment') {
                this.currentFacingMode = 'user';
                await this.setupCamera();
            }
        }
    }

    startProcessingLoop() {
        const process = async () => {
            if (this.video.paused || this.video.ended) return;
            await this.faceMesh.send({ image: this.video });
            this.animationId = requestAnimationFrame(process);
        };
        process();
    }

    async switchCamera() {
        this.currentFacingMode = this.currentFacingMode === 'user' ? 'environment' : 'user';
        await this.setupCamera();
    }

    setupFaceMesh() {
        if (this.faceMesh) return;

        this.faceMesh = new FaceMesh({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
        });

        this.faceMesh.setOptions({
            maxNumFaces: 4,
            refineLandmarks: true,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });

        this.faceMesh.onResults((results) => {
            this.multiFaceLandmarks = results.multiFaceLandmarks || [];
            this.render();
        });
    }

    handleCanvasClick(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;

        let minDest = Infinity;
        let closestIndex = -1;

        this.multiFaceLandmarks.forEach((landmarks, index) => {
            const center = landmarks[1]; // Nose tip
            const dist = Math.hypot(x - center.x, y - center.y);
            if (dist < minDest) {
                minDest = dist;
                closestIndex = index;
            }
        });

        if (minDest < 0.2 && closestIndex !== -1) {
            this.selectedFaceIndex = closestIndex;
        }
    }

    render() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        if (this.multiFaceLandmarks.length > 0) {
            const selectedLandmarks = this.multiFaceLandmarks[this.selectedFaceIndex] || this.multiFaceLandmarks[0];
            if (!this.multiFaceLandmarks[this.selectedFaceIndex]) this.selectedFaceIndex = 0;

            // 1. Dev mode visualization
            if (this.isDevMode) {
                this.multiFaceLandmarks.forEach((landmarks, i) => {
                    this.drawMouth(landmarks, i === this.selectedFaceIndex);
                });
            }

            // 2. Logic for selected person
            const ratio = this.getMouthRatio(selectedLandmarks);
            if (this.isListening && ratio > 0.02) {
                this.updateStatus('TALKING');
                this.updateBorder('talking');
            } else if (this.isListening) {
                this.updateStatus('LISTENING');
                this.updateBorder('listening');
            }
        } else {
            if (this.isListening) {
                this.updateStatus('WAITING FOR FACE');
                this.updateBorder('');
            }
        }
    }

    drawMouth(landmarks, isSelected) {
        const mouthIndices = [61, 146, 91, 181, 84, 17, 314, 405, 320, 307, 375, 321, 308, 324, 318];
        this.ctx.strokeStyle = isSelected ? '#0f0' : 'rgba(255, 255, 255, 0.3)';
        this.ctx.lineWidth = isSelected ? 3 : 1;
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
        const vDist = Math.hypot((top.x-bottom.x)*this.canvas.width, (top.y-bottom.y)*this.canvas.height);
        const hDist = Math.hypot((left.x-right.x)*this.canvas.width, (left.y-right.y)*this.canvas.height);
        return hDist > 0 ? vDist / hDist : 0;
    }

    setupSpeech() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) return;

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

        this.recognition.onend = () => {
            if (this.isListening) {
                setTimeout(() => { if (this.isListening) this.recognition.start(); }, 100);
            }
        };
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

    displayOverlayResponse(data) {
        this.overlay.innerHTML = '';
        const msgDiv = document.createElement('div');
        msgDiv.className = 'overlay-msg';
        
        // Truth Indicator
        const truthDiv = document.createElement('div');
        truthDiv.className = 'overlay-truth';
        truthDiv.textContent = data.truth ? 'FACTUALLY ACCURATE' : 'FACTUALLY INCORRECT';
        
        // Original Statement
        const statementDiv = document.createElement('div');
        statementDiv.className = 'overlay-statement';
        statementDiv.textContent = `"${data.text}"`;
        
        // Counterargument
        const counterDiv = document.createElement('div');
        counterDiv.className = 'overlay-counter';
        
        msgDiv.appendChild(truthDiv);
        msgDiv.appendChild(statementDiv);
        msgDiv.appendChild(counterDiv);
        this.overlay.appendChild(msgDiv);

        this.typeText(counterDiv, data.counterargument, 0);
    }

    typeText(element, text, index) {
        if (index < text.length) {
            element.textContent += text[index];
            setTimeout(() => this.typeText(element, text, index + 1), 10);
        }
    }

    updateStatus(text) { if (this.isDevMode) this.status.textContent = text; }
    updateBorder(state) { this.border.className = state; }
    showLoading() { this.loading.classList.remove('hidden'); }
    hideLoading() { this.loading.classList.add('hidden'); }
    resizeCanvas() {
        const rect = this.video.getBoundingClientRect();
        this.canvas.width = rect.width;
        this.canvas.height = rect.height;
    }
}

document.addEventListener('DOMContentLoaded', () => new App());
