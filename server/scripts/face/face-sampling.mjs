function invariant(condition, message) {
  if (!condition) throw new Error(`face sampling failed: ${message}`);
}

export function createPrng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function smoothstep(start, end, value) {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
}

export function makeDensity(luminance, size, mode) {
  invariant(luminance.length === size * size, "luminance dimensions do not match");
  invariant(mode === "stipple" || mode === "glow", "density mode is invalid");
  const density = new Float32Array(luminance.length);
  let maximum = 0;
  let total = 0;
  for (let y = 0; y < size; y += 1) {
    const v = (y + 0.5) / size;
    const fade = 1 - smoothstep(0.7, 0.98, v);
    for (let x = 0; x < size; x += 1) {
      const index = y * size + x;
      const light = luminance[index] / 255;
      if (light <= 0.07) continue;
      const weight = mode === "stipple"
        ? (Math.pow(1 - light, 1.35) + 0.03) * fade
        : Math.pow(smoothstep(0.07, 0.95, light), 0.85) * fade;
      density[index] = weight;
      maximum = Math.max(maximum, weight);
      total += weight;
    }
  }
  invariant(maximum > 0 && total > 0, `${mode} density is empty`);
  return { density, maximum };
}

function rejectionSample(density, maximum, size, count, random) {
  const x = new Float32Array(count);
  const y = new Float32Array(count);
  let accepted = 0;
  let attempts = 0;
  const maximumAttempts = count * 500;
  while (accepted < count && attempts < maximumAttempts) {
    attempts += 1;
    const sampleX = random() * size;
    const sampleY = random() * size;
    const weight = density[Math.min(size - 1, sampleY | 0) * size + Math.min(size - 1, sampleX | 0)];
    if (random() * maximum <= weight) {
      x[accepted] = sampleX;
      y[accepted] = sampleY;
      accepted += 1;
    }
  }
  invariant(accepted === count, `accepted ${accepted}/${count} density samples`);
  return { x, y };
}

function buildPointGrid(x, y, size, cellSize) {
  const cells = Math.ceil(size / cellSize);
  const counts = new Uint32Array(cells * cells);
  for (let index = 0; index < x.length; index += 1) {
    const gx = Math.min(cells - 1, Math.max(0, (x[index] / cellSize) | 0));
    const gy = Math.min(cells - 1, Math.max(0, (y[index] / cellSize) | 0));
    counts[gy * cells + gx] += 1;
  }
  const starts = new Uint32Array(counts.length + 1);
  for (let index = 0; index < counts.length; index += 1) starts[index + 1] = starts[index] + counts[index];
  const cursor = starts.slice(0, -1);
  const items = new Uint32Array(x.length);
  for (let index = 0; index < x.length; index += 1) {
    const gx = Math.min(cells - 1, Math.max(0, (x[index] / cellSize) | 0));
    const gy = Math.min(cells - 1, Math.max(0, (y[index] / cellSize) | 0));
    const cell = gy * cells + gx;
    items[cursor[cell]] = index;
    cursor[cell] += 1;
  }
  return { cells, starts, items };
}

function refineLloyd(points, density, size, iterations) {
  const count = points.x.length;
  const cellSize = Math.max(2, Math.sqrt((size * size) / count) * 1.5);
  const mass = new Float64Array(count);
  const sumX = new Float64Array(count);
  const sumY = new Float64Array(count);
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const grid = buildPointGrid(points.x, points.y, size, cellSize);
    mass.fill(0);
    sumX.fill(0);
    sumY.fill(0);
    for (let py = 0; py < size; py += 1) {
      const gy = Math.min(grid.cells - 1, (py / cellSize) | 0);
      for (let px = 0; px < size; px += 1) {
        const weight = density[py * size + px];
        if (weight === 0) continue;
        const gx = Math.min(grid.cells - 1, (px / cellSize) | 0);
        let nearest = -1;
        let nearestDistance = Infinity;
        for (let radius = 1; radius <= 4 && nearest < 0; radius += 1) {
          const minY = Math.max(0, gy - radius);
          const maxY = Math.min(grid.cells - 1, gy + radius);
          const minX = Math.max(0, gx - radius);
          const maxX = Math.min(grid.cells - 1, gx + radius);
          for (let cellY = minY; cellY <= maxY; cellY += 1) {
            for (let cellX = minX; cellX <= maxX; cellX += 1) {
              const cell = cellY * grid.cells + cellX;
              for (let cursor = grid.starts[cell]; cursor < grid.starts[cell + 1]; cursor += 1) {
                const candidate = grid.items[cursor];
                const dx = points.x[candidate] - px - 0.5;
                const dy = points.y[candidate] - py - 0.5;
                const distance = dx * dx + dy * dy;
                if (distance < nearestDistance) {
                  nearestDistance = distance;
                  nearest = candidate;
                }
              }
            }
          }
        }
        if (nearest >= 0) {
          mass[nearest] += weight;
          sumX[nearest] += weight * (px + 0.5);
          sumY[nearest] += weight * (py + 0.5);
        }
      }
    }
    for (let index = 0; index < count; index += 1) {
      if (mass[index] > 0) {
        points.x[index] = sumX[index] / mass[index];
        points.y[index] = sumY[index] / mass[index];
      }
    }
  }
  return points;
}

function balancedSpatialOrder(x, y, random, gridSize = 8) {
  const buckets = Array.from({ length: gridSize * gridSize }, () => []);
  for (let index = 0; index < x.length; index += 1) {
    const cellX = Math.min(gridSize - 1, Math.max(0, (x[index] * gridSize) | 0));
    const cellY = Math.min(gridSize - 1, Math.max(0, (y[index] * gridSize) | 0));
    buckets[cellY * gridSize + cellX].push(index);
  }
  const scheduled = [];
  for (let cell = 0; cell < buckets.length; cell += 1) {
    const bucket = buckets[cell];
    for (let index = bucket.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(random() * (index + 1));
      [bucket[index], bucket[swap]] = [bucket[swap], bucket[index]];
    }
    for (let rank = 0; rank < bucket.length; rank += 1) {
      scheduled.push({
        index: bucket[rank],
        phase: (rank + random()) / bucket.length,
        tie: random(),
      });
    }
  }
  scheduled.sort((left, right) => left.phase - right.phase || left.tie - right.tie || left.index - right.index);
  return scheduled.map(({ index }) => index);
}

function sampleTone(luminance, size, x, y) {
  const px = Math.min(size - 1, Math.max(0, x | 0));
  const py = Math.min(size - 1, Math.max(0, y | 0));
  return luminance[py * size + px];
}

export function generatePointSet({ luminance, size, count, seed, mode, iterations = 0 }) {
  const random = createPrng(seed);
  const { density, maximum } = makeDensity(luminance, size, mode);
  const pixels = rejectionSample(density, maximum, size, count, random);
  if (iterations > 0) refineLloyd(pixels, density, size, iterations);
  const localU = new Float32Array(count);
  const localV = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    localU[index] = Math.max(0, Math.min(1, pixels.x[index] / size));
    localV[index] = Math.max(0, Math.min(1, pixels.y[index] / size));
  }
  const order = balancedSpatialOrder(localU, localV, random);
  const u = new Float32Array(count);
  const v = new Float32Array(count);
  const tone = new Uint8Array(count);
  for (let output = 0; output < count; output += 1) {
    const input = order[output];
    u[output] = localU[input];
    v[output] = localV[input];
    tone[output] = sampleTone(luminance, size, pixels.x[input], pixels.y[input]);
  }
  return { u, v, tone };
}

export function spatialHistogram(points, count = points.u.length, gridSize = 8) {
  const histogram = new Uint32Array(gridSize * gridSize);
  const limit = Math.min(count, points.u.length);
  for (let index = 0; index < limit; index += 1) {
    const x = Math.min(gridSize - 1, Math.max(0, (points.u[index] * gridSize) | 0));
    const y = Math.min(gridSize - 1, Math.max(0, (points.v[index] * gridSize) | 0));
    histogram[y * gridSize + x] += 1;
  }
  return histogram;
}

export function maximumNormalisedHistogramDelta(points, prefixCount, gridSize = 8) {
  const prefix = spatialHistogram(points, prefixCount, gridSize);
  const full = spatialHistogram(points, points.u.length, gridSize);
  let maximum = 0;
  for (let index = 0; index < full.length; index += 1) {
    maximum = Math.max(
      maximum,
      Math.abs(prefix[index] / prefixCount - full[index] / points.u.length),
    );
  }
  return maximum;
}
