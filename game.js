'use strict';

/* ==========================================================================
   Hexa Merge & Multiply: The Splitter
   Vanilla Canvas 2D physics puzzle game.
   ========================================================================== */

const GRAVITY = 900;
const WALL_RESTITUTION = 0.55;
const PEG_RESTITUTION = 0.62;
const FLOOR_RESTITUTION = 0.28;
const BLOCK_RESTITUTION = 0.18;
const SETTLE_VEL = 26;
const STUCK_SPEED = 40;
const STUCK_TIME = 0.6;
const MERGE_TOLERANCE = 4;
const DROP_COOLDOWN = 0.32;
const GATE_DEBOUNCE = 0.05;

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function colorForValue(value) {
  const tier = Math.log2(value) % 3;
  if (tier === 1) return { main: '#ff007f', glow: 'rgba(255,0,127,0.9)' };
  if (tier === 2) return { main: '#bd00ff', glow: 'rgba(189,0,255,0.9)' };
  return { main: '#00f3ff', glow: 'rgba(0,243,255,0.9)' };
}

/* ---------------------------- Particle ---------------------------------- */

class Particle {
  constructor(x, y, vx, vy, color) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.color = color;
    this.life = 0;
    this.maxLife = 0.4 + Math.random() * 0.35;
    this.size = 2 + Math.random() * 3;
  }

  update(dt) {
    this.life += dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vx *= 0.92;
    this.vy *= 0.92;
  }

  get dead() {
    return this.life >= this.maxLife;
  }

  draw(ctx) {
    const alpha = Math.max(0, 1 - this.life / this.maxLife);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = this.color;
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 15;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/* ------------------------------- Peg ------------------------------------ */

class Peg {
  constructor(x, y, radius = 5) {
    this.x = x;
    this.y = y;
    this.radius = radius;
  }

  draw(ctx) {
    ctx.save();
    ctx.shadowBlur = 15;
    ctx.shadowColor = 'rgba(0,243,255,0.85)';
    ctx.fillStyle = '#00f3ff';
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/* ------------------------------- Gate ------------------------------------ */

let gateSeq = 0;

class Gate {
  constructor(opts) {
    this.id = 'gate_' + (gateSeq++);
    this.type = opts.type; // 'x2' | '+16' | 'split'
    this.y = opts.y;
    this.width = opts.width || 120;
    this.baseX = opts.x;
    this.x = opts.x;
    this.moving = !!opts.moving;
    this.amplitude = opts.amplitude || 0;
    this.speed = opts.speed || 1;
    this.phase = Math.random() * Math.PI * 2;
    this.flash = 0;
    if (this.type === 'x2') this.color = '#ff007f';
    else if (this.type === 'split') this.color = '#bd00ff';
    else this.color = '#00f3ff';
  }

  get left() { return this.x - this.width / 2; }
  get right() { return this.x + this.width / 2; }

  label() {
    if (this.type === 'x2') return 'x2';
    if (this.type === 'split') return 'SPLIT';
    return '+16';
  }

  update(dt, time) {
    if (this.moving) {
      this.x = this.baseX + Math.sin(time * this.speed + this.phase) * this.amplitude;
    }
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 2.5);
  }

  tryTrigger(block, game) {
    if (block.settled || block.vy <= 0) return;
    if (block.lastY > this.y || block.y < this.y) return; // must cross this frame, falling
    if (block.x < this.left || block.x > this.right) return;
    const last = block.triggeredGates.get(this.id);
    if (last !== undefined && game.time - last < GATE_DEBOUNCE) return;
    block.triggeredGates.set(this.id, game.time);
    this.flash = 1;
    game.applyGateEffect(block, this);
  }

  draw(ctx) {
    ctx.save();
    ctx.globalAlpha = 0.85 + this.flash * 0.15;
    ctx.shadowBlur = 15 + this.flash * 22;
    ctx.shadowColor = this.color;
    ctx.strokeStyle = this.color;
    ctx.fillStyle = this.color;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(this.left, this.y);
    ctx.lineTo(this.right, this.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(this.left, this.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(this.right, this.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = 'bold 13px Orbitron, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowBlur = 10;
    ctx.fillText(this.label(), this.x, this.y - 14);
    ctx.restore();
  }
}

/* ------------------------------- Block ----------------------------------- */

let blockSeq = 0;

class Block {
  constructor(x, y, value) {
    this.id = blockSeq++;
    this.x = x;
    this.y = y;
    this.vx = (Math.random() - 0.5) * 16;
    this.vy = 0;
    this.value = value;
    this.settled = false;
    this.spawnScale = 0;
    this.lastY = y;
    this.triggeredGates = new Map();
    this.restTimer = 0;
  }

  get radius() {
    return clamp(15 + Math.log2(this.value) * 2.2, 15, 34);
  }

  update(dt, game) {
    this.lastY = this.y;
    if (this.spawnScale < 1) this.spawnScale = Math.min(1, this.spawnScale + dt * 6);

    if (this.settled) {
      this.vx *= 0.9;
      this.vy *= 0.9;
      if (Math.abs(this.vx) < 2 && Math.abs(this.vy) < 2) { this.vx = 0; this.vy = 0; }
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.resolveWalls(game);
      this.resolveFloor(game);
      return;
    }

    this.vy += GRAVITY * dt;
    this.vx *= 0.999;
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    this.resolveWalls(game);
    for (const peg of game.pegs) this.resolvePeg(peg);
    for (const gate of game.gates) gate.tryTrigger(this, game);
    this.resolveFloor(game);

    // A block can find a stable equilibrium wedged between a peg and a wall
    // or between two pegs: the wall and peg position corrections fight each
    // other every frame, so a velocity nudge alone can't win. Detect the
    // stall and physically bump the block past it so it keeps falling.
    if (!this.settled) {
      const speed = Math.hypot(this.vx, this.vy);
      if (speed < STUCK_SPEED) {
        this.restTimer += dt;
        if (this.restTimer > STUCK_TIME) {
          this.y += this.radius * 1.8;
          this.x = clamp(this.x + (Math.random() - 0.5) * 30, game.playLeft + this.radius, game.playRight - this.radius);
          this.vx = (Math.random() - 0.5) * 60;
          this.vy = 80;
          this.restTimer = 0;
        }
      } else {
        this.restTimer = 0;
      }
    }
  }

  resolveWalls(game) {
    const r = this.radius;
    if (this.x - r < game.playLeft) {
      this.x = game.playLeft + r;
      this.vx = Math.abs(this.vx) * WALL_RESTITUTION;
    } else if (this.x + r > game.playRight) {
      this.x = game.playRight - r;
      this.vx = -Math.abs(this.vx) * WALL_RESTITUTION;
    }
  }

  resolvePeg(peg) {
    const dx = this.x - peg.x;
    const dy = this.y - peg.y;
    const dist = Math.hypot(dx, dy) || 0.0001;
    const minDist = this.radius + peg.radius;
    if (dist < minDist) {
      const nx = dx / dist, ny = dy / dist;
      this.x = peg.x + nx * minDist;
      this.y = peg.y + ny * minDist;
      const vDotN = this.vx * nx + this.vy * ny;
      this.vx -= (1 + PEG_RESTITUTION) * vDotN * nx;
      this.vy -= (1 + PEG_RESTITUTION) * vDotN * ny;
      this.vx += (Math.random() - 0.5) * 40;
    }
  }

  resolveFloor(game) {
    const r = this.radius;
    const floorY = game.playBottom;
    if (this.y + r > floorY) {
      this.y = floorY - r;
      if (this.vy > 0) this.vy = -this.vy * FLOOR_RESTITUTION;
      if (Math.abs(this.vy) < SETTLE_VEL && Math.abs(this.vx) < SETTLE_VEL) {
        this.settle();
      }
    }
  }

  settle() {
    this.settled = true;
    this.vx = 0;
    this.vy = 0;
  }

  draw(ctx) {
    const { main, glow } = colorForValue(this.value);
    const r = this.radius * this.spawnScale;
    if (r <= 0) return;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.shadowBlur = 15;
    ctx.shadowColor = glow;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i - Math.PI / 2;
      const px = Math.cos(angle) * r, py = Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    const grad = ctx.createRadialGradient(0, 0, r * 0.1, 0, 0, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.4, main);
    grad.addColorStop(1, 'rgba(0,0,0,0.8)');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = main;
    ctx.stroke();
    ctx.shadowBlur = 8;
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.max(10, r * 0.6)}px Orbitron, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(this.value), 0, 1);
    ctx.restore();
  }
}

/* ------------------------------- Game ------------------------------------ */

class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    this.W = 380;
    this.H = 640;
    this.playLeft = 14;
    this.playRight = this.W - 14;
    this.playBottom = this.H - 10;
    this.warningY = 95;

    this.blocks = [];
    this.pegs = [];
    this.gates = [];
    this.particles = [];

    this.time = 0;
    this.lastTs = null;
    this.state = 'idle'; // idle | playing | gameover
    this.dropCooldown = 0;
    this.previewX = this.W / 2;
    this.warningTimer = 0;
    this.rescued = false;

    this.score = 0;
    this.gold = 0;
    this.highScore = 0;
    this.startTierIndex = 0;
    this.tiers = [2, 4, 8];
    this.tierCosts = [0, 500, 2000];

    this.dom = {
      score: document.getElementById('scoreValue'),
      highScore: document.getElementById('highScoreValue'),
      gold: document.getElementById('goldValue'),
      currentStart: document.getElementById('currentStartValue'),
      upgradeBtn: document.getElementById('upgradeBtn'),
      upgradeCost: document.getElementById('upgradeCost'),
      nextPreview: document.getElementById('nextBlockPreview'),
      startOverlay: document.getElementById('startOverlay'),
      gameOverOverlay: document.getElementById('gameOverOverlay'),
      finalScore: document.getElementById('finalScore'),
      rescueBtn: document.getElementById('rescueBtn'),
    };

    this.load();
    this.buildPegs();
    this.buildGates();
    this.bindInput();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.updateHUD();
    requestAnimationFrame((ts) => this.loop(ts));
  }

  /* ----- level layout ----- */

  buildPegs() {
    this.pegs = [];
    const rows = 5;
    const rowSpacing = 38;
    const startY = 120;
    const cols = 6;
    const colSpacing = (this.playRight - this.playLeft) / cols;
    for (let r = 0; r < rows; r++) {
      const y = startY + r * rowSpacing;
      const offset = r % 2 === 0 ? 0 : colSpacing / 2;
      for (let c = 0; c <= cols; c++) {
        const x = this.playLeft + offset + c * colSpacing;
        if (x < this.playLeft + 48 || x > this.playRight - 48) continue;
        this.pegs.push(new Peg(x, y, 5));
      }
    }
  }

  buildGates() {
    this.gates = [];
    const midX = (this.playLeft + this.playRight) / 2;
    this.gates.push(new Gate({ type: 'x2', x: midX, y: 335, width: 120, moving: true, amplitude: 65, speed: 0.8 }));
    this.gates.push(new Gate({ type: 'split', x: this.playLeft + 65, y: 385, width: 95 }));
    this.gates.push(new Gate({ type: '+16', x: this.playRight - 65, y: 385, width: 95 }));
  }

  /* ----- input ----- */

  bindInput() {
    const getX = (evt) => {
      const rect = this.canvas.getBoundingClientRect();
      const clientX = evt.touches && evt.touches.length ? evt.touches[0].clientX : evt.clientX;
      const scale = rect.width / this.W;
      return (clientX - rect.left) / scale;
    };
    const move = (e) => {
      this.previewX = clamp(getX(e), this.playLeft + 20, this.playRight - 20);
    };
    const drop = (e) => {
      move(e);
      this.tryDrop();
    };
    this.canvas.addEventListener('mousemove', move);
    this.canvas.addEventListener('mousedown', drop);
    this.canvas.addEventListener('touchmove', (e) => { e.preventDefault(); move(e); }, { passive: false });
    this.canvas.addEventListener('touchstart', (e) => { e.preventDefault(); drop(e); }, { passive: false });
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const scale = rect.width / this.W;
    this.ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
  }

  /* ----- state control ----- */

  startGame() {
    this.blocks = [];
    this.particles = [];
    this.score = 0;
    this.warningTimer = 0;
    this.rescued = false;
    this.state = 'playing';
    this.dom.startOverlay.classList.add('hidden');
    this.dom.gameOverOverlay.classList.add('hidden');
    this.updateHUD();
  }

  restart() {
    this.startGame();
  }

  gameOver() {
    this.state = 'gameover';
    if (this.score > this.highScore) this.highScore = this.score;
    this.save();
    this.dom.finalScore.textContent = this.score;
    this.dom.gameOverOverlay.classList.remove('hidden');
    this.dom.rescueBtn.disabled = this.rescued;
    this.updateHUD();
  }

  rescue() {
    if (this.rescued) return;
    this.rescued = true;
    const cutoff = this.H * 0.55;
    this.blocks = this.blocks.filter((b) => b.y < cutoff);
    this.warningTimer = 0;
    this.state = 'playing';
    this.dom.gameOverOverlay.classList.add('hidden');
  }

  tryDrop() {
    if (this.state !== 'playing' || this.dropCooldown > 0) return;
    const value = this.tiers[this.startTierIndex];
    const b = new Block(this.previewX, 26, value);
    this.blocks.push(b);
    this.dropCooldown = DROP_COOLDOWN;
  }

  attemptUpgrade() {
    const next = this.startTierIndex + 1;
    if (next >= this.tiers.length) return;
    const cost = this.tierCosts[next];
    if (this.gold < cost) return;
    this.gold -= cost;
    this.startTierIndex = next;
    this.save();
    this.updateHUD();
  }

  /* ----- gate effects ----- */

  applyGateEffect(block, gate) {
    if (gate.type === 'x2') {
      block.value *= 2;
    } else if (gate.type === '+16') {
      block.value += 16;
    } else if (gate.type === 'split') {
      const clone = new Block(block.x - block.radius * 0.6, block.y, block.value);
      clone.vy = block.vy;
      clone.vx = -80 - Math.random() * 40;
      block.vx = 80 + Math.random() * 40;
      this.blocks.push(clone);
    }
    this.spawnBurst(block.x, gate.y, gate.color, 8, 40, 100);
  }

  /* ----- physics passes ----- */

  resolveBlockCollisions() {
    const blocks = this.blocks;
    for (let i = 0; i < blocks.length; i++) {
      for (let j = i + 1; j < blocks.length; j++) {
        const a = blocks[i], b = blocks[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 0.0001;
        const minDist = a.radius + b.radius;
        if (dist >= minDist) continue;

        const overlap = minDist - dist;
        const nx = dx / dist, ny = dy / dist;
        const ma = a.value, mb = b.value;
        const totalMass = ma + mb;
        let aMove, bMove;
        if (a.settled && !b.settled) { aMove = 0; bMove = 1; }
        else if (b.settled && !a.settled) { aMove = 1; bMove = 0; }
        else { aMove = mb / totalMass; bMove = ma / totalMass; }

        a.x -= nx * overlap * aMove;
        a.y -= ny * overlap * aMove;
        b.x += nx * overlap * bMove;
        b.y += ny * overlap * bMove;

        const relVx = b.vx - a.vx, relVy = b.vy - a.vy;
        const velAlongNormal = relVx * nx + relVy * ny;
        if (velAlongNormal < 0) {
          const impulse = (-(1 + BLOCK_RESTITUTION) * velAlongNormal) / (1 / ma + 1 / mb);
          const ix = impulse * nx, iy = impulse * ny;
          if (!a.settled) { a.vx -= ix / ma; a.vy -= iy / ma; }
          if (!b.settled) { b.vx += ix / mb; b.vy += iy / mb; }
        }

        if (a.settled && !b.settled && ny < -0.4 && Math.abs(b.vy) < SETTLE_VEL * 1.5) b.settle();
        if (b.settled && !a.settled && ny > 0.4 && Math.abs(a.vy) < SETTLE_VEL * 1.5) a.settle();
      }
    }
  }

  checkMerges() {
    const blocks = this.blocks;
    const taken = new Set();
    const pairs = [];
    for (let i = 0; i < blocks.length; i++) {
      const a = blocks[i];
      if (!a.settled || taken.has(a.id)) continue;
      for (let j = i + 1; j < blocks.length; j++) {
        const b = blocks[j];
        if (!b.settled || taken.has(b.id)) continue;
        if (a.value !== b.value) continue;
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (dist <= a.radius + b.radius + MERGE_TOLERANCE) {
          pairs.push([a, b]);
          taken.add(a.id);
          taken.add(b.id);
          break;
        }
      }
    }
    for (const [a, b] of pairs) this.mergeBlocks(a, b);
  }

  mergeBlocks(a, b) {
    const newValue = a.value + b.value;
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    this.blocks = this.blocks.filter((bl) => bl.id !== a.id && bl.id !== b.id);
    const merged = new Block(midX, midY, newValue);
    merged.settled = true;
    merged.spawnScale = 1;
    this.blocks.push(merged);
    this.score += newValue;
    this.gold += newValue;
    this.spawnShockwave(midX, midY, newValue);
    this.updateHUD();
  }

  spawnBurst(x, y, color, count, minSpeed, maxSpeed) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = minSpeed + Math.random() * (maxSpeed - minSpeed);
      this.particles.push(new Particle(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed, color));
    }
  }

  spawnShockwave(x, y, value) {
    const color = colorForValue(value).main;
    this.spawnBurst(x, y, color, 20, 80, 220);
    const pushRadius = 130;
    for (const blk of this.blocks) {
      const dx = blk.x - x, dy = blk.y - y;
      const dist = Math.hypot(dx, dy) || 0.0001;
      if (dist < pushRadius && dist > 0.1) {
        const force = (1 - dist / pushRadius) * 240;
        blk.vx += (dx / dist) * force;
        blk.vy += (dy / dist) * force;
        if (force > 50) blk.settled = false;
      }
    }
  }

  // A merge removes two blocks and can leave whatever was resting on top of
  // them "settled" with nothing underneath any more. Drop anything that has
  // lost its floor or its supporting neighbor so it falls and re-settles.
  checkSupport() {
    const blocks = this.blocks;
    for (const b of blocks) {
      if (!b.settled) continue;
      if (b.y + b.radius >= this.playBottom - 2) continue;
      let supported = false;
      for (const c of blocks) {
        if (c === b) continue;
        const dy = c.y - b.y;
        if (dy <= 0) continue;
        const dist = Math.hypot(c.x - b.x, dy);
        if (dist <= b.radius + c.radius + 4) { supported = true; break; }
      }
      if (!supported) {
        b.settled = false;
        b.restTimer = 0;
      }
    }
  }

  checkGameOver(dt) {
    let danger = false;
    for (const b of this.blocks) {
      if (b.settled && b.y - b.radius < this.warningY) { danger = true; break; }
    }
    if (danger) {
      this.warningTimer += dt;
      if (this.warningTimer > 1.0) this.gameOver();
    } else {
      this.warningTimer = Math.max(0, this.warningTimer - dt * 2);
    }
  }

  /* ----- persistence ----- */

  load() {
    this.highScore = Number(localStorage.getItem('hexaMerge.highScore')) || 0;
    this.gold = Number(localStorage.getItem('hexaMerge.gold')) || 0;
    this.startTierIndex = Number(localStorage.getItem('hexaMerge.startTier')) || 0;
  }

  save() {
    localStorage.setItem('hexaMerge.highScore', String(this.highScore));
    localStorage.setItem('hexaMerge.gold', String(this.gold));
    localStorage.setItem('hexaMerge.startTier', String(this.startTierIndex));
  }

  updateHUD() {
    this.dom.score.textContent = this.score;
    this.dom.highScore.textContent = this.highScore;
    this.dom.gold.textContent = this.gold;
    const startValue = this.tiers[this.startTierIndex];
    this.dom.currentStart.textContent = startValue;
    this.dom.nextPreview.textContent = startValue;

    const next = this.startTierIndex + 1;
    if (next >= this.tiers.length) {
      this.dom.upgradeBtn.disabled = true;
      this.dom.upgradeCost.textContent = 'MAX POZIOM';
    } else {
      const cost = this.tierCosts[next];
      this.dom.upgradeCost.textContent = `${cost} złota → start ${this.tiers[next]}`;
      this.dom.upgradeBtn.disabled = this.gold < cost;
    }
  }

  /* ----- main loop ----- */

  loop(ts) {
    if (this.lastTs === null) this.lastTs = ts;
    let dt = (ts - this.lastTs) / 1000;
    this.lastTs = ts;
    dt = Math.min(dt, 1 / 30);

    if (this.state === 'playing') {
      this.time += dt;
      this.dropCooldown = Math.max(0, this.dropCooldown - dt);
      for (const gate of this.gates) gate.update(dt, this.time);
      for (const b of this.blocks) b.update(dt, this);
      this.resolveBlockCollisions();
      this.checkMerges();
      this.checkSupport();
      this.checkGameOver(dt);
    }

    for (const p of this.particles) p.update(dt);
    this.particles = this.particles.filter((p) => !p.dead);

    this.render();
    requestAnimationFrame((t) => this.loop(t));
  }

  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.W, this.H);

    ctx.save();
    ctx.strokeStyle = 'rgba(255,0,127,0.6)';
    ctx.shadowColor = '#ff007f';
    ctx.shadowBlur = 10;
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(this.playLeft, this.warningY);
    ctx.lineTo(this.playRight, this.warningY);
    ctx.stroke();
    ctx.restore();

    for (const peg of this.pegs) peg.draw(ctx);
    for (const gate of this.gates) gate.draw(ctx);
    for (const b of this.blocks) b.draw(ctx);
    for (const p of this.particles) p.draw(ctx);

    if (this.state === 'playing') {
      ctx.save();
      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = '#00f3ff';
      ctx.shadowColor = '#00f3ff';
      ctx.shadowBlur = 10;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(this.previewX, 26, 15, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
}

/* ------------------------------ bootstrap -------------------------------- */

window.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('gameCanvas');
  const game = new Game(canvas);

  document.getElementById('startBtn').addEventListener('click', () => game.startGame());
  document.getElementById('restartBtn').addEventListener('click', () => game.restart());
  document.getElementById('rescueBtn').addEventListener('click', () => game.rescue());
  document.getElementById('upgradeBtn').addEventListener('click', () => game.attemptUpgrade());
});
