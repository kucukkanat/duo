// render.js — WebGL2 metaball renderer (additive splats -> half-float field -> glossy shading pass),
// with a Canvas2D blur+threshold fallback.

const SPLAT_VS = `#version 300 es
layout(location=0) in vec2 aPos;
layout(location=1) in vec3 aCol;
layout(location=2) in float aSpeed;
uniform vec4 uCam;      // x0,y0,x1,y1 (sim px)
uniform float uSize;    // point size in field pixels
out vec3 vCol; out float vSpeed;
void main(){
  vec2 n = (aPos - uCam.xy) / (uCam.zw - uCam.xy);
  gl_Position = vec4(n.x*2.0-1.0, 1.0-n.y*2.0, 0.0, 1.0);
  gl_PointSize = uSize;
  vCol = aCol; vSpeed = aSpeed;
}`;
const SPLAT_FS = `#version 300 es
precision highp float;
in vec3 vCol; in float vSpeed;
layout(location=0) out vec4 o0;
layout(location=1) out vec4 o1;
void main(){
  vec2 c = gl_PointCoord*2.0-1.0;
  float r2 = dot(c,c);
  if (r2 > 1.0) discard;
  float w = 1.0 - r2; w = w*w*w;
  o0 = vec4(vCol*w, w);
  o1 = vec4(min(vSpeed, 3.0)*w, 0.0, 0.0, w);
}`;

const QUAD_VS = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1,-1), vec2(3,-1), vec2(-1,3));
out vec2 vUv;
void main(){ vec2 p = P[gl_VertexID]; vUv = p*0.5+0.5; gl_Position = vec4(p,0,1); }`;

const SHADE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uField, uVel;
uniform vec2 uTexel;     // field texel
uniform vec2 uRes;       // screen css px
uniform vec4 uCam;       // sim rect shown
uniform vec2 uWorld;     // world extent (sim px)
uniform vec4 uWall;      // pos, gapC, gapHalf, thick
uniform vec4 uWall2;     // on, axis, grow(0..1), piston
uniform vec3 uFx;        // flash, reveal(new half 0..1), time
uniform vec2 uLight;     // "up" direction in screen space (y down)
uniform float uThresh;
// theme
uniform vec3 uBg0, uBg1, uGlowC, uHot, uCrust;
uniform vec4 uMat;       // glow, iri, metal, crust
uniform float uDensK;

float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }

uniform sampler2D uBgTex;
float worldMask(vec2 p){
  float inside = step(0.0, p.x)*step(p.x, uWorld.x)*step(0.0, p.y)*step(p.y, uWorld.y);
  if (uWall2.x > 0.5) {
    float a = uWall2.y < 0.5 ? p.x : p.y;
    inside *= step(a, uWall2.w);
    inside *= mix(1.0, uFx.y, step(uWall.x, a));   // new half not yet revealed
  }
  return inside;
}
vec3 background(vec2 uv, vec2 p){
  return mix(uBg1*0.22, texture(uBgTex, uv).rgb, worldMask(p));
}

float field(vec2 uv){ return texture(uField, uv).a; }
float hgt(vec2 uv){ float w = textureLod(uField, uv, 1.0).a; return 1.0 - exp(-max(w - uThresh*0.55, 0.0) * 0.9); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }

void main(){
  vec2 sp = vec2(vUv.x, 1.0 - vUv.y);
  vec2 p = uCam.xy + sp * (uCam.zw - uCam.xy);
  float pxPerSim = uRes.x / (uCam.z - uCam.x);

  vec4 F = texture(uField, vUv);
  float w = F.a;
  vec3 bg = background(vUv, p);
  // bloom: blurred field from mips
  float wb = textureLod(uField, vUv, 3.0).a + textureLod(uField, vUv, 4.5).a * 0.8;
  vec3 col = bg;
  if (wb > 0.01) {
    vec4 Fb = textureLod(uField, vUv, 3.5);
    vec3 glowCol = mix(uGlowC, Fb.rgb / max(Fb.a, 1e-4), 0.6);
    col += glowCol * uMat.x * 0.22 * smoothstep(0.0, 2.0, wb);
  }
  if (w > uThresh * 0.5) {
  vec3 base = F.rgb / max(w, 1e-4);
  float spd = texture(uVel, vUv).r / max(w, 1e-4);

  // normal from a smoothed height field (saturating, so the bulk is flat and edges roll off)
  vec2 e = uTexel * 2.0;
  float hl = hgt(vUv - vec2(e.x,0.0)), hr = hgt(vUv + vec2(e.x,0.0));
  float hd = hgt(vUv - vec2(0.0,e.y)), hu = hgt(vUv + vec2(0.0,e.y));
  vec2 grad = vec2(hr - hl, -(hu - hd));          // screen space, y down
  vec3 N = normalize(vec3(-grad * uDensK, 1.0));
  float mask = smoothstep(uThresh - 0.08, uThresh + 0.08, w);
  float thick = clamp((w - uThresh) / 3.0, 0.0, 1.0);

  // refraction of the background
  vec2 ro = N.xy * (0.6 + thick) * 26.0 / uRes;
  vec3 refr = background(vUv + vec2(ro.x, -ro.y), p + N.xy * 26.0);

  // light from "up" (opposite gravity) and towards viewer
  vec3 L = normalize(vec3(uLight * 0.85, 0.65));
  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 H = normalize(L + V);
  float ndl = max(dot(N, L), 0.0);
  float nh = max(dot(N, H), 0.0);
  float spec = pow(nh, 90.0);
  float sheen = pow(nh, 12.0);
  float fres = pow(1.0 - N.z, 2.2);

  // speed tint: slow -> crust, fast -> hot
  float heat = smoothstep(0.02, 0.35, spd);
  vec3 body = mix(base, uHot, heat * 0.55);
  float crustAmt = 0.0;
  if (uMat.w > 0.0) {
    // crust: cracked skin pattern where the liquid is slow
    float cr = vnoise(p * 0.03 + vec2(uFx.z * 0.05, 0.0)) * 0.65 + vnoise(p * 0.085 - uFx.z * 0.03) * 0.35;
    float plate = smoothstep(0.015, 0.06, abs(cr - 0.5));           // 0 on the glowing cracks
    float slow = 1.0 - smoothstep(0.02, 0.16, spd);
    crustAmt = uMat.w * slow * plate * smoothstep(0.05, 0.5, thick);
    body = mix(body, uCrust, crustAmt * 0.75);
    body += uHot * uMat.w * slow * (1.0 - plate) * 0.6 * smoothstep(0.05, 0.4, thick);
  }

  vec3 iri = 0.5 + 0.5*cos(6.2832*(vec3(0.0,0.33,0.67) + fres*1.3 + thick*0.6 + uFx.z*0.04));

  vec3 liquid = mix(refr, refr * body * 1.6 + body * 0.55, 0.82);
  liquid *= 0.75 + 0.35 * ndl;
  liquid += body * (0.2 + 0.5*thick + 0.6*heat) * uMat.x * 0.6 * (1.0 - crustAmt*0.7);  // emissive glow
  liquid += iri * fres * uMat.y;
  liquid += mix(body, vec3(1.0), 0.5) * fres * 0.55;              // rim
  if (uMat.z > 0.0) {
    // chrome: reflect a studio environment
    vec3 R = reflect(-V, N);
    float envY = dot(R.xy, -uLight);
    vec3 env = mix(vec3(0.03,0.035,0.045), vec3(1.0), smoothstep(-0.05, 0.55, envY));
    env += vec3(0.9) * smoothstep(0.86, 0.95, envY);
    env = mix(env, env*vec3(0.75,0.85,1.05), 0.5) * (0.55 + 0.45*N.z);
    vec3 chrome = env * mix(vec3(1.0), base, 0.35) + refr * 0.25 + iri * fres * 0.2;
    liquid = mix(liquid, chrome, uMat.z);
  }
  liquid += vec3(1.0, 0.98, 0.94) * (spec * 1.6 + sheen * 0.12);
  col = mix(col, liquid, mask);
  }

  // glass divider
  if (uWall2.x > 0.5) {
    float a = uWall2.y < 0.5 ? p.x : p.y;
    float q = uWall2.y < 0.5 ? p.y : p.x;
    float ext = uWall2.y < 0.5 ? uWorld.y : uWorld.x;
    float dA = abs(a - uWall.x);
    float dG = abs(q - uWall.y) - uWall.z;           // >0 outside gap
    // wall grows in from both ends towards gap
    float reach = mix(0.0, 1.0, uWall2.z);
    float fromEnd = q < uWall.y ? q / max(uWall.y, 1.0) : (ext - q) / max(ext - uWall.y, 1.0);
    float present = step(fromEnd, reach * 1.02);
    float inWall = step(dA, uWall.w) * step(0.0, dG) * present;
    vec3 glass = col * 0.55 + uGlowC * 0.18 + vec3(0.9) * (1.0 - smoothstep(0.0, 1.5, abs(dA - uWall.w + 1.0))) * 0.5;
    glass += vec3(0.35) * (1.0 - smoothstep(0.0, 1.0, dA));
    col = mix(col, glass, inWall);
    // halo
    col += uGlowC * 0.12 * exp(-dA / 10.0) * present * step(0.0, dG);
    // gap beads
    vec2 b1 = uWall2.y < 0.5 ? vec2(uWall.x, uWall.y - uWall.z) : vec2(uWall.y - uWall.z, uWall.x);
    vec2 b2 = uWall2.y < 0.5 ? vec2(uWall.x, uWall.y + uWall.z) : vec2(uWall.y + uWall.z, uWall.x);
    float bd = min(length(p - b1), length(p - b2));
    col += mix(uGlowC, vec3(1.0), 0.4) * (smoothstep(uWall.w + 2.5, uWall.w - 0.5, bd) * 0.9 + exp(-bd / 9.0) * 0.45) * present;
    // gap glow
    float gapGlow = exp(-dA / 18.0) * smoothstep(0.0, -uWall.z, dG) * step(1.0, uWall.z);
    col += uGlowC * gapGlow * 0.25;
    // chromatic flash at the gap
    if (uFx.x > 0.0) {
      vec2 gc = uWall2.y < 0.5 ? vec2(uWall.x, uWall.y) : vec2(uWall.y, uWall.x);
      vec2 dv = (p - gc) / 120.0;
      float fl = uFx.x;
      vec3 chroma = vec3(exp(-dot(dv*0.92,dv*0.92)*3.0), exp(-dot(dv,dv)*3.0), exp(-dot(dv*1.1,dv*1.1)*3.0));
      col += chroma * fl * 1.4 + mix(uGlowC, vec3(1.0), 0.5) * fl * 0.25 * exp(-dA / 60.0);
    }
    // piston
    if (uWall2.w < 1e8) {
      float dp = abs(a - uWall2.w);
      col += mix(uGlowC, vec3(1.0), 0.5) * (exp(-dp / 4.0) * 0.8 + exp(-dp / 30.0) * 0.2);
    }
  }
  // gentle tone map
  col = col / (1.0 + max(max(col.r, col.g), col.b) * 0.18);
  col += (hash(vUv * uRes + uFx.z) - 0.5) / 255.0;
  o = vec4(col, 1.0);
}`;

const BG_FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform vec4 uCam; uniform vec2 uWorld; uniform vec3 uBg0, uBg1, uGlowC;
void main(){
  vec2 sp = vec2(vUv.x, 1.0 - vUv.y);
  vec2 p = uCam.xy + sp * (uCam.zw - uCam.xy);
  vec2 wn = p / uWorld;
  vec3 c = mix(uBg0, uBg1, smoothstep(-0.1, 1.1, wn.y));
  for (int i=0;i<6;i++){
    float fi = float(i);
    vec2 bc = vec2(fract(0.17+fi*0.31), fract(0.23+fi*0.47));
    float rr = 0.08 + 0.07*fract(fi*0.73);
    float d = length((wn - bc) * vec2(uWorld.x/uWorld.y, 1.0));
    c += uGlowC * (0.05 + 0.03*fract(fi*0.37)) * smoothstep(rr, rr*0.2, d);
  }
  vec2 g = mod(p, 22.0) - 11.0;
  c += vec3(0.055) * smoothstep(1.5, 0.4, length(g)) * (0.6 + 0.4*wn.y);
  vec2 v = sp - 0.5;
  c *= 1.0 - dot(v,v)*0.9;
  o = vec4(c, 1.0);
}`;

const SPARK_VS = `#version 300 es
layout(location=0) in vec2 aPos;
layout(location=1) in vec3 aCol;
layout(location=2) in float aLife;
uniform vec4 uCam; uniform float uScale;
out vec3 vCol; out float vLife;
void main(){
  vec2 n = (aPos - uCam.xy) / (uCam.zw - uCam.xy);
  gl_Position = vec4(n.x*2.0-1.0, 1.0-n.y*2.0, 0.0, 1.0);
  gl_PointSize = uScale * (2.5 + 7.0*aLife);
  vCol = aCol; vLife = aLife;
}`;
const SPARK_FS = `#version 300 es
precision mediump float;
in vec3 vCol; in float vLife; out vec4 o;
void main(){
  vec2 c = gl_PointCoord*2.0-1.0; float r = dot(c,c);
  if (r > 1.0) discard;
  float core = smoothstep(0.35, 0.0, r);
  float a = (1.0 - r); a *= a;
  o = vec4((vCol * a * 0.9 + vec3(1.0) * core * 0.8) * vLife, 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
  return { p, u };
}

const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);

export class GLRenderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('no webgl2');
    this.gl = gl; this.canvas = canvas;
    const fext = gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float');
    this.fmt = fext ? { internal: gl.RGBA16F, type: gl.HALF_FLOAT } : { internal: gl.RGBA8, type: gl.UNSIGNED_BYTE };
    this.lowPrecision = !fext;
    this.splat = program(gl, SPLAT_VS, SPLAT_FS);
    this.shade = program(gl, QUAD_VS, SHADE_FS);
    this.spark = program(gl, SPARK_VS, SPARK_FS);
    this.bgp = program(gl, QUAD_VS, BG_FS);
    this.bgKey = '';
    this.prof = /[?&]prof/.test(location.search) ? {} : null;
    this.vao = gl.createVertexArray();
    this.buf = gl.createBuffer();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 8);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 24, 20);
    this.svao = gl.createVertexArray();
    this.sbuf = gl.createBuffer();
    gl.bindVertexArray(this.svao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.sbuf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 8);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 24, 20);
    gl.bindVertexArray(null);
    this.emptyVao = gl.createVertexArray();
    this.data = new Float32Array(0);
    this.sdata = new Float32Array(0);
    this.fw = 0; this.fh = 0;
    canvas.addEventListener('webglcontextlost', e => e.preventDefault());
  }

  makeTex(w, h) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    const levels = 1 + Math.floor(Math.log2(Math.max(w, h)));
    gl.texStorage2D(gl.TEXTURE_2D, levels, this.fmt.internal, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  resize(cssW, cssH, scale, fieldScale) {
    const gl = this.gl;
    const w = Math.max(1, Math.round(cssW * scale)), h = Math.max(1, Math.round(cssH * scale));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    if (this.bgW !== w || this.bgH !== h) {
      if (this.bgTex) { gl.deleteTexture(this.bgTex); gl.deleteFramebuffer(this.bgFbo); }
      this.bgW = w; this.bgH = h;
      this.bgTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.bgFbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.bgFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.bgTex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.bgKey = '';
    }
    const fw = Math.max(16, Math.round(cssW * fieldScale)), fh = Math.max(16, Math.round(cssH * fieldScale));
    if (fw !== this.fw || fh !== this.fh) {
      if (this.fbo) { gl.deleteFramebuffer(this.fbo); gl.deleteTexture(this.tex0); gl.deleteTexture(this.tex1); }
      this.fw = fw; this.fh = fh;
      this.tex0 = this.makeTex(fw, fh); this.tex1 = this.makeTex(fw, fh);
      this.fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex0, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.tex1, 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    this.cssW = cssW; this.cssH = cssH;
  }

  render(f, sparks, st) {
    const gl = this.gl, n = f.n;
    // ---- pack particles
    if (this.data.length < n * 6) this.data = new Float32Array(f.max * 6);
    const d = this.data, lp = this.lowPrecision ? 0.35 : 1;
    for (let i = 0, o = 0; i < n; i++, o += 6) {
      d[o] = f.x[i]; d[o + 1] = f.y[i]; d[o + 2] = f.r[i]; d[o + 3] = f.g[i]; d[o + 4] = f.b[i]; d[o + 5] = f.speed[i];
    }
    const cam = st.cam, camW = cam[2] - cam[0];
    // ---- splat pass
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.fw, this.fh);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(this.splat.p);
    gl.uniform4fv(this.splat.u.uCam, cam);
    gl.uniform1f(this.splat.u.uSize, 2 * st.splatR * this.fw / camW);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, d.subarray(0, n * 6), gl.STREAM_DRAW);
    const P = this.prof ? (k) => { gl.finish(); const t = performance.now(); this.prof[k] = (this.prof[k] || 0) * 0.9 + (t - this.pt) * 0.1; this.pt = t; } : null;
    if (P) { gl.finish(); this.pt = performance.now(); }
    gl.drawArrays(gl.POINTS, 0, n);
    P && P('splat');
    gl.bindTexture(gl.TEXTURE_2D, this.tex0); gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindTexture(gl.TEXTURE_2D, this.tex1); gl.generateMipmap(gl.TEXTURE_2D);
    P && P('mip');
    // ---- background (cached; only redrawn when camera/world/theme change)
    const th0 = st.theme;
    const key = cam.join(',') + '|' + f.W + ',' + f.H + '|' + th0.id;
    if (key !== this.bgKey) {
      this.bgKey = key;
      gl.disable(gl.BLEND);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.bgFbo);
      gl.viewport(0, 0, this.bgW, this.bgH);
      const b = this.bgp;
      gl.useProgram(b.p);
      gl.uniform4fv(b.u.uCam, cam); gl.uniform2f(b.u.uWorld, f.W, f.H);
      gl.uniform3fv(b.u.uBg0, th0.bg0); gl.uniform3fv(b.u.uBg1, th0.bg1); gl.uniform3fv(b.u.uGlowC, th0.glowC);
      gl.bindVertexArray(this.emptyVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    P && P('bg');
    // ---- shade pass
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.disable(gl.BLEND);
    const s = this.shade, u = s.u, th = st.theme;
    gl.useProgram(s.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex0); gl.uniform1i(u.uField, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.tex1); gl.uniform1i(u.uVel, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.bgTex); gl.uniform1i(u.uBgTex, 2);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform2f(u.uTexel, 1 / this.fw, 1 / this.fh);
    gl.uniform2f(u.uRes, this.cssW, this.cssH);
    gl.uniform4fv(u.uCam, cam);
    gl.uniform2f(u.uWorld, f.W, f.H);
    const w = f.wall;
    gl.uniform4f(u.uWall, w.pos, w.gapC, w.gapHalf, w.thick);
    gl.uniform4f(u.uWall2, w.on ? 1 : 0, w.axis, st.wallGrow, Number.isFinite(f.limit) ? f.limit : 1e9);
    gl.uniform3f(u.uFx, st.flash, st.reveal, st.time);
    gl.uniform2f(u.uLight, st.light[0], st.light[1]);
    gl.uniform1f(u.uThresh, 1.0 * lp);
    gl.uniform1f(u.uDensK, 7.0);
    gl.uniform3fv(u.uBg0, th.bg0); gl.uniform3fv(u.uBg1, th.bg1); gl.uniform3fv(u.uGlowC, th.glowC);
    gl.uniform3fv(u.uHot, th.hotC); gl.uniform3fv(u.uCrust, th.crustC);
    gl.uniform4f(u.uMat, th.glow, th.iri, th.metal, th.crust);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    P && P('shade');
    // ---- sparks
    const sn = sparks.n;
    if (sn) {
      if (this.sdata.length < sn * 6) this.sdata = new Float32Array(sparks.max * 6);
      const sd = this.sdata;
      for (let i = 0, o = 0; i < sn; i++, o += 6) {
        sd[o] = sparks.x[i]; sd[o + 1] = sparks.y[i]; sd[o + 2] = sparks.r[i]; sd[o + 3] = sparks.g[i]; sd[o + 4] = sparks.b[i]; sd[o + 5] = sparks.life[i];
      }
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(this.spark.p);
      gl.uniform4fv(this.spark.u.uCam, cam);
      gl.uniform1f(this.spark.u.uScale, this.canvas.width / this.cssW * (this.cssW / camW));
      gl.bindVertexArray(this.svao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.sbuf);
      gl.bufferData(gl.ARRAY_BUFFER, sd.subarray(0, sn * 6), gl.STREAM_DRAW);
      gl.drawArrays(gl.POINTS, 0, sn);
      gl.disable(gl.BLEND);
    }
    gl.bindVertexArray(null);
  }
}

/** Fallback: Canvas2D, blur + contrast threshold. */
export class CanvasRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.off = document.createElement('canvas');
    this.octx = this.off.getContext('2d');
  }
  resize(cssW, cssH, scale) {
    this.canvas.width = Math.round(cssW * scale); this.canvas.height = Math.round(cssH * scale);
    this.off.width = Math.round(cssW / 3); this.off.height = Math.round(cssH / 3);
    this.cssW = cssW; this.cssH = cssH;
  }
  render(f, sparks, st) {
    const { octx, off, ctx, canvas } = this, cam = st.cam, th = st.theme;
    const sx = off.width / (cam[2] - cam[0]), sy = off.height / (cam[3] - cam[1]);
    octx.fillStyle = '#000'; octx.fillRect(0, 0, off.width, off.height);
    const rr = st.splatR * sx * 0.75;
    for (let i = 0; i < f.n; i++) {
      octx.fillStyle = `rgb(${f.r[i] * 255 | 0},${f.g[i] * 255 | 0},${f.b[i] * 255 | 0})`;
      octx.fillRect((f.x[i] - cam[0]) * sx - rr, (f.y[i] - cam[1]) * sy - rr, rr * 2, rr * 2);
    }
    const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
    g.addColorStop(0, rgb(th.bg0)); g.addColorStop(1, rgb(th.bg1));
    ctx.fillStyle = g; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.filter = 'blur(6px) contrast(6) brightness(1.1)';
    ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
    ctx.restore();
    if (f.wall.on) {
      const k = canvas.width / (cam[2] - cam[0]), w = f.wall;
      ctx.fillStyle = 'rgba(255,255,255,.35)';
      const a = (w.pos - (w.axis ? cam[1] : cam[0])) * k, g0 = (w.gapC - w.gapHalf - (w.axis ? cam[0] : cam[1])) * k, g1 = (w.gapC + w.gapHalf - (w.axis ? cam[0] : cam[1])) * k;
      if (!w.axis) { ctx.fillRect(a - 3, 0, 6, g0); ctx.fillRect(a - 3, g1, 6, canvas.height); }
      else { ctx.fillRect(0, a - 3, g0, 6); ctx.fillRect(g1, a - 3, canvas.width, 6); }
    }
  }
}
const rgb = c => `rgb(${c.map(v => v * 255 | 0).join(',')})`;
export { hex };
