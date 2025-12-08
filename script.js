// ByteInfer.ai — Animations

// Particle Background
class GraphCanvas {
    constructor() {
        this.canvas = document.getElementById('graph-canvas');
        if (!this.canvas) return;

        this.ctx = this.canvas.getContext('2d');
        this.nodes = [];
        this.mouse = { x: null, y: null };

        this.init();
        this.animate();

        window.addEventListener('resize', () => this.resize());
        window.addEventListener('mousemove', (e) => {
            this.mouse.x = e.clientX;
            this.mouse.y = e.clientY;
        });
    }

    init() {
        this.resize();
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        this.createNodes();
    }

    createNodes() {
        const count = Math.floor((window.innerWidth * window.innerHeight) / 30000);
        this.nodes = [];

        for (let i = 0; i < count; i++) {
            this.nodes.push({
                x: Math.random() * this.canvas.width,
                y: Math.random() * this.canvas.height,
                vx: (Math.random() - 0.5) * 0.3,
                vy: (Math.random() - 0.5) * 0.3,
                radius: Math.random() * 1.5 + 0.5,
                opacity: Math.random() * 0.3 + 0.1
            });
        }
    }

    distance(a, b) {
        return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
    }

    update() {
        for (const node of this.nodes) {
            node.x += node.vx;
            node.y += node.vy;

            if (node.x < 0) node.x = this.canvas.width;
            if (node.x > this.canvas.width) node.x = 0;
            if (node.y < 0) node.y = this.canvas.height;
            if (node.y > this.canvas.height) node.y = 0;

            if (this.mouse.x && this.mouse.y) {
                const dist = this.distance(node, this.mouse);
                if (dist < 120 && dist > 30) {
                    const force = (120 - dist) / 120 * 0.008;
                    const angle = Math.atan2(this.mouse.y - node.y, this.mouse.x - node.x);
                    node.vx += Math.cos(angle) * force;
                    node.vy += Math.sin(angle) * force;
                }
            }

            const speed = Math.sqrt(node.vx ** 2 + node.vy ** 2);
            if (speed > 0.6) {
                node.vx = (node.vx / speed) * 0.6;
                node.vy = (node.vy / speed) * 0.6;
            }
        }
    }

    draw() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        const maxDist = 100;
        for (let i = 0; i < this.nodes.length; i++) {
            for (let j = i + 1; j < this.nodes.length; j++) {
                const dist = this.distance(this.nodes[i], this.nodes[j]);
                if (dist < maxDist) {
                    const opacity = (1 - dist / maxDist) * 0.1;
                    this.ctx.beginPath();
                    this.ctx.moveTo(this.nodes[i].x, this.nodes[i].y);
                    this.ctx.lineTo(this.nodes[j].x, this.nodes[j].y);
                    this.ctx.strokeStyle = `rgba(255, 107, 53, ${opacity})`;
                    this.ctx.lineWidth = 1;
                    this.ctx.stroke();
                }
            }
        }

        for (const node of this.nodes) {
            this.ctx.beginPath();
            this.ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
            this.ctx.fillStyle = `rgba(255, 107, 53, ${node.opacity})`;
            this.ctx.fill();
        }
    }

    animate() {
        this.update();
        this.draw();
        requestAnimationFrame(() => this.animate());
    }
}

// Fullscreen Neural Network Background
class NeuralBackground {
    constructor() {
        this.canvas = document.getElementById('neural-canvas');
        if (!this.canvas) return;

        this.ctx = this.canvas.getContext('2d');
        this.nodes = [];
        this.edges = [];
        this.pulseProgress = 0;
        this.pulseSpeed = 0.006;

        this.init();
        this.animate();

        window.addEventListener('resize', () => this.resize());
    }

    init() {
        this.resize();
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        this.createGraph();
    }

    createGraph() {
        this.nodes = [];
        this.edges = [];

        const w = this.canvas.width;
        const h = this.canvas.height;
        const padding = 60;

        // Create a grid of nodes spanning the full screen
        const cols = 5;
        const rows = 3;
        const cellW = (w - padding * 2) / (cols - 1);
        const cellH = (h - padding * 2) / (rows - 1);

        let id = 0;
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                // Add some randomness to positions
                const jitterX = (Math.random() - 0.5) * cellW * 0.4;
                const jitterY = (Math.random() - 0.5) * cellH * 0.4;

                this.nodes.push({
                    id: id++,
                    x: padding + col * cellW + jitterX,
                    y: padding + row * cellH + jitterY,
                    size: 5 + Math.random() * 6,
                    col: col,
                    row: row
                });
            }
        }

        // Create DAG-like edges (connect to nodes ahead and nearby)
        for (const node of this.nodes) {
            const candidates = this.nodes.filter(n =>
                n.col > node.col &&
                n.col <= node.col + 2 &&
                Math.abs(n.row - node.row) <= 1
            );

            // Connect to 1-2 random candidates
            const shuffled = candidates.sort(() => Math.random() - 0.5);
            const connectCount = Math.min(shuffled.length, 1 + Math.floor(Math.random() * 2));

            for (let i = 0; i < connectCount; i++) {
                this.edges.push({ from: node.id, to: shuffled[i].id });
            }
        }
    }

    draw() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        this.pulseProgress += this.pulseSpeed;
        if (this.pulseProgress > 1) this.pulseProgress = 0;

        // Draw edges with glowing activation
        for (let i = 0; i < this.edges.length; i++) {
            const edge = this.edges[i];
            const from = this.nodes[edge.from];
            const to = this.nodes[edge.to];

            // Stagger activation based on edge index and column
            const phase = (this.pulseProgress + from.col * 0.15 + i * 0.02) % 1;
            const glow = Math.sin(phase * Math.PI) * 0.4;

            this.ctx.beginPath();
            this.ctx.moveTo(from.x, from.y);
            this.ctx.lineTo(to.x, to.y);
            this.ctx.strokeStyle = `rgba(255, 107, 53, ${0.08 + glow})`;
            this.ctx.lineWidth = 1 + glow * 2;
            this.ctx.stroke();
        }

        // Draw nodes
        for (const node of this.nodes) {
            // Node activation based on column timing
            const phase = (this.pulseProgress + node.col * 0.15) % 1;
            const activation = Math.sin(phase * Math.PI) * 0.3;

            this.ctx.beginPath();
            this.ctx.arc(node.x, node.y, node.size, 0, Math.PI * 2);
            this.ctx.fillStyle = `rgba(255, 107, 53, ${0.2 + activation})`;
            this.ctx.fill();
        }
    }

    animate() {
        this.draw();
        requestAnimationFrame(() => this.animate());
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    new GraphCanvas();
    new NeuralBackground();
});

console.log('%c🔥 ByteInfer Labs', 'color: #ff6b35; font-size: 24px; font-weight: bold;');
console.log('%cInference has a new language.', 'color: #666; font-size: 12px;');
