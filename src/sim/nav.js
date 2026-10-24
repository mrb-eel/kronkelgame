// Grid A* navigation for the two walkable levels (0 = shop floor + alley, 1 = rooftop terrace).
// Obstacles come from layout.json and depend on which upgrades/tables exist.

const CELL = 0.2;

export class Nav {
  constructor(layout, { tables = layout.tables, upgrades = new Set() } = {}) {
    this.L = layout;
    this.levels = [this._ground(tables, upgrades), this._terrace(tables)];
  }

  _grid(x0, x1, z0, z1) {
    const w = Math.ceil((x1 - x0) / CELL);
    const h = Math.ceil((z1 - z0) / CELL);
    return { x0, z0, w, h, block: new Uint8Array(w * h) };
  }

  _rect(g, ax, az, bx, bz, v = 1) {
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - g.x0) / CELL));
    const i1 = Math.min(g.w - 1, Math.floor((Math.max(ax, bx) - g.x0) / CELL));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz) - g.z0) / CELL));
    const j1 = Math.min(g.h - 1, Math.floor((Math.max(az, bz) - g.z0) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) g.block[j * g.w + i] = v;
  }

  _circle(g, cx, cz, r) {
    for (let j = 0; j < g.h; j++) {
      const z = g.z0 + (j + 0.5) * CELL;
      if (Math.abs(z - cz) > r) continue;
      for (let i = 0; i < g.w; i++) {
        const x = g.x0 + (i + 0.5) * CELL;
        if ((x - cx) ** 2 + (z - cz) ** 2 <= r * r) g.block[j * g.w + i] = 1;
      }
    }
  }

  _ground(tables, upgrades) {
    const L = this.L;
    const g = this._grid(-17, 17, -6, L.alley.maxZ);
    // Everything outside the shop interior and the alley is blocked
    this._rect(g, -17, -6, -7.05, 6.25);
    this._rect(g, 7.05, -6, 17, 6.25);
    // Front wall with the door gap
    this._rect(g, -7.1, 5.92, L.door.x - 0.55, 6.32);
    this._rect(g, L.door.x + 0.55, 5.92, 7.1, 6.32);
    this._rect(g, -17, L.alley.maxZ - 0.35, 17, L.alley.maxZ); // bikes along the opposite wall
    // Inner walls (keep a margin so people don't scrape them)
    this._rect(g, -7.1, -6, 7.1, -5.75);
    this._rect(g, -7.1, -6, -6.75, 6);
    this._rect(g, 6.75, -6, 7.1, 6);
    // Counters and staff areas
    const C = L.counter;
    this._rect(g, C.minX - 0.15, -6, C.maxX + 0.4, C.maxZ + 0.18);
    const B = L.bar;
    this._rect(g, B.minX - 0.4, -6, B.maxX + 0.3, -4.35);
    const A = B.arc;
    this._arc(g, A.cx, A.cz, A.rOut + 0.25, B.minX - 0.3, B.maxX + 0.3);
    const S = L.gameShelf;
    if (upgrades.has('gameShelf')) this._rect(g, S.minX - 0.2, S.minZ - 0.1, 7, S.maxZ + 0.1);
    if (upgrades.has('stage')) {
      const st = L.stage;
      this._rect(g, st.minX - 0.1, st.minZ - 0.1, st.maxX, st.maxZ);
    }
    if (upgrades.has('pool')) for (const p of L.pool) this._rect(g, p.x - 1.4, p.z - 0.85, p.x + 1.4, p.z + 0.85);
    if (upgrades.has('lounge')) this._rect(g, -7, L.fireplace.z - 1.0, -6.4, L.fireplace.z + 1.0);
    if (upgrades.has('plants')) {
      for (const [x, z] of [[6.45, -2.2], [-0.6, 5.55], [-6.6, -2.7], [1.25, -2.9], [3.55, 5.6], [-6.55, -2.2]]) {
        this._circle(g, x, z, 0.35);
      }
    }
    if (upgrades.has('vaporizer')) this._circle(g, 6.55, -0.6, 0.4);
    for (const t of tables) {
      if (t.level !== 0) continue;
      this._circle(g, t.x, t.z, (L.tableRadius[t.type] || 1) - 0.05);
    }
    return g;
  }

  _arc(g, cx, cz, r, xmin, xmax) {
    for (let j = 0; j < g.h; j++) {
      const z = g.z0 + (j + 0.5) * CELL;
      for (let i = 0; i < g.w; i++) {
        const x = g.x0 + (i + 0.5) * CELL;
        if (x < xmin || x > xmax) continue;
        if ((x - cx) ** 2 + (z - cz) ** 2 <= r * r) g.block[j * g.w + i] = 1;
      }
    }
  }

  _terrace(tables) {
    const T = this.L.terrace;
    const g = this._grid(T.minX - 0.2, T.maxX + 0.2, T.minZ - 0.2, T.maxZ + 0.6);
    this._rect(g, -7, -6.2, -6.0, 3); // planters
    this._rect(g, 6.0, -6.2, 7, 3);
    this._rect(g, -6.6, -6.2, -4.4, -4.9); // lounge pallets
    for (const t of tables) {
      if (t.level !== 1) continue;
      this._circle(g, t.x, t.z, (this.L.tableRadius[t.type] || 1) - 0.05);
    }
    return g;
  }

  blocked(level, x, z) {
    const g = this.levels[level];
    const i = Math.floor((x - g.x0) / CELL);
    const j = Math.floor((z - g.z0) / CELL);
    if (i < 0 || j < 0 || i >= g.w || j >= g.h) return true;
    return g.block[j * g.w + i] === 1;
  }

  /** Path from a to b on one level. `reach` > 0 stops within that distance of b (for tables). */
  path(level, ax, az, bx, bz, reach = 0) {
    const g = this.levels[level];
    const toCell = (x, z) => [
      Math.min(g.w - 1, Math.max(0, Math.floor((x - g.x0) / CELL))),
      Math.min(g.h - 1, Math.max(0, Math.floor((z - g.z0) / CELL))),
    ];
    let [si, sj] = toCell(ax, az);
    // If we start inside an obstacle (e.g. just stood up from a seat), step out to the nearest free cell.
    if (g.block[sj * g.w + si]) [si, sj] = this._nearestFree(g, si, sj);
    let [gi, gj] = toCell(bx, bz);
    const goalWorld = [bx, bz];
    const reachCells = reach / CELL;
    if (!reach && g.block[gj * g.w + gi]) [gi, gj] = this._nearestFree(g, gi, gj);
    const W = g.w;
    const N = g.w * g.h;
    const gScore = new Float32Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const heap = new MinHeap();
    const start = sj * W + si;
    const h = (i, j) => Math.hypot(i - gi, j - gj);
    gScore[start] = 0;
    heap.push(start, h(si, sj));
    let goal = -1;
    const isGoal = (i, j) => {
      if (reach) {
        const x = g.x0 + (i + 0.5) * CELL;
        const z = g.z0 + (j + 0.5) * CELL;
        return Math.hypot(x - goalWorld[0], z - goalWorld[1]) <= reach;
      }
      return i === gi && j === gj;
    };
    const dirs = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414],
      [-1, -1, 1.414]];
    let iterations = 0;
    while (heap.size && iterations++ < 40000) {
      const cur = heap.pop();
      if (closed[cur]) continue;
      closed[cur] = 1;
      const ci = cur % W;
      const cj = (cur / W) | 0;
      if (isGoal(ci, cj)) {
        goal = cur;
        break;
      }
      for (const [di, dj, cost] of dirs) {
        const ni = ci + di;
        const nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= W || nj >= g.h) continue;
        const n = nj * W + ni;
        if (g.block[n] || closed[n]) continue;
        if (di && dj && (g.block[cj * W + ni] || g.block[nj * W + ci])) continue; // no corner cutting
        const ng = gScore[cur] + cost;
        if (ng < gScore[n]) {
          gScore[n] = ng;
          came[n] = cur;
          heap.push(n, ng + (reach ? Math.max(0, h(ni, nj) - reachCells) : h(ni, nj)));
        }
      }
    }
    if (goal < 0) return [[bx, bz]];
    const cells = [];
    for (let c = goal; c >= 0; c = came[c]) cells.push(c);
    cells.reverse();
    const pts = cells.map((c) => [g.x0 + ((c % W) + 0.5) * CELL, g.z0 + (((c / W) | 0) + 0.5) * CELL]);
    if (!reach) pts[pts.length - 1] = [bx, bz];
    pts[0] = [ax, az];
    return this._smooth(level, pts);
  }

  _nearestFree(g, i, j) {
    for (let r = 1; r < 30; r++) {
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const ni = i + di;
          const nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= g.w || nj >= g.h) continue;
          if (!g.block[nj * g.w + ni]) return [ni, nj];
        }
      }
    }
    return [i, j];
  }

  _clear(level, a, b) {
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.ceil(d / (CELL * 0.5));
    for (let k = 1; k < n; k++) {
      const t = k / n;
      if (this.blocked(level, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)) return false;
    }
    return true;
  }

  _smooth(level, pts) {
    if (pts.length <= 2) return pts;
    const out = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      while (j > i + 1 && !this._clear(level, pts[i], pts[j])) j--;
      out.push(pts[j]);
      i = j;
    }
    return out;
  }
}

export function pathLength(pts) {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return d;
}

/**
 * Moves an entity {x, z, yaw} along entity.path at `speed`. Returns true when the path is done.
 * Pure helper shared by all sims so movement is deterministic and testable.
 */
export function stepAlong(e, speed, dt) {
  if (!e.path || !e.path.length) return true;
  let left = speed * dt;
  while (left > 0 && e.path.length) {
    const [tx, tz] = e.path[0];
    const dx = tx - e.x;
    const dz = tz - e.z;
    const d = Math.hypot(dx, dz);
    if (d > 1e-4) e.yaw = Math.atan2(dx, dz);
    if (d <= left) {
      e.x = tx;
      e.z = tz;
      left -= d;
      e.path.shift();
    } else {
      e.x += (dx / d) * left;
      e.z += (dz / d) * left;
      left = 0;
    }
  }
  return e.path.length === 0;
}

class MinHeap {
  constructor() {
    this.k = [];
    this.p = [];
  }

  get size() {
    return this.k.length;
  }

  push(key, pri) {
    const k = this.k;
    const p = this.p;
    k.push(key);
    p.push(pri);
    let i = k.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (p[parent] <= p[i]) break;
      [k[i], k[parent]] = [k[parent], k[i]];
      [p[i], p[parent]] = [p[parent], p[i]];
      i = parent;
    }
  }

  pop() {
    const k = this.k;
    const p = this.p;
    const top = k[0];
    const lk = k.pop();
    const lp = p.pop();
    if (k.length) {
      k[0] = lk;
      p[0] = lp;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < k.length && p[l] < p[m]) m = l;
        if (r < k.length && p[r] < p[m]) m = r;
        if (m === i) break;
        [k[i], k[m]] = [k[m], k[i]];
        [p[i], p[m]] = [p[m], p[i]];
        i = m;
      }
    }
    return top;
  }
}
