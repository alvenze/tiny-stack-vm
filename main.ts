// Tiny stack VM for make.fun's tiny stack ISA v1, written from the bounty's spec
// (ISA.md in the kit). One run answers a whole set: for each <id> in the input dir
// it runs <id>/program.bin on <id>/input.bin and writes <output>/<id>/stdout.bin
// and <output>/<id>/exit.txt. Wrapping signed 32-bit values, a 256-value stack,
// 64 return addresses, 256 words of memory, at most 1,000,000 steps and 65,536
// output bytes per program. Every failure is one of the ISA's ten traps, ends with
// the trap's exit code, and keeps prior output. Checks follow the spec's order:
// limit, pc, opcode, immediate, stack, own trap. Plain JS in a .ts file.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function run(prog, input) {
  const stack = new Int32Array(256), calls = new Int32Array(64), mem = new Int32Array(256);
  const out = new Uint8Array(65536), n = prog.length;
  let sp = 0, csp = 0, pc = 0, steps = 0, olen = 0, ipos = 0;
  const end = (code) => ({ out: out.slice(0, olen), code });
  for (;;) {
    if (steps >= 1000000) return end(10);
    if (pc < 0 || pc >= n) return end(9);
    const op = prog[pc];
    steps++;
    let next = pc + 1; // the next instruction
    if (op >= 0x10 && op <= 0x22 && op !== 0x17 && op !== 0x1b && op !== 0x1f) {
      // Binary ops ( a b -- r ).
      if (sp < 2) return end(2);
      const b = stack[sp - 1], a = stack[sp - 2];
      if (op >= 0x13 && op <= 0x16 && b === 0) return end(4);
      let r;
      if (op === 0x10) r = (a + b) | 0;
      else if (op === 0x11) r = (a - b) | 0;
      else if (op === 0x12) r = Math.imul(a, b);
      else if (op === 0x13) r = a === -2147483648 && b === -1 ? a : (a / b) | 0;
      else if (op === 0x14) r = b === -1 ? 0 : (a % b) | 0;
      else if (op === 0x15) r = Math.floor((a >>> 0) / (b >>> 0)) | 0;
      else if (op === 0x16) r = ((a >>> 0) % (b >>> 0)) | 0;
      else if (op === 0x18) r = a & b;
      else if (op === 0x19) r = a | b;
      else if (op === 0x1a) r = a ^ b;
      else if (op === 0x1c) r = a << (b & 31);
      else if (op === 0x1d) r = a >> (b & 31);
      else if (op === 0x1e) r = (a >>> (b & 31)) | 0;
      else if (op === 0x20) r = a === b ? 1 : 0;
      else if (op === 0x21) r = a < b ? 1 : 0;
      else r = (a >>> 0) < (b >>> 0) ? 1 : 0; // LTU
      stack[sp - 2] = r;
      sp--;
    } else switch (op) {
      case 0x00: return end(0); // HALT
      case 0x01: // PUSH8 (sign-extended)
        next = pc + 2;
        if (next > n) return end(9);
        if (sp >= 256) return end(3);
        stack[sp++] = (prog[pc + 1] << 24) >> 24; break;
      case 0x02: // PUSH32: little-endian word
        next = pc + 5;
        if (next > n) return end(9);
        if (sp >= 256) return end(3);
        stack[sp++] = prog[pc + 1] | (prog[pc + 2] << 8) | (prog[pc + 3] << 16) | (prog[pc + 4] << 24); break;
      case 0x03:
        if (sp < 1) return end(2);
        sp--; break;
      case 0x04:
        if (sp < 1) return end(2);
        if (sp >= 256) return end(3);
        stack[sp] = stack[sp - 1]; sp++; break;
      case 0x05: {
        if (sp < 2) return end(2);
        const t = stack[sp - 1]; stack[sp - 1] = stack[sp - 2]; stack[sp - 2] = t; break;
      }
      case 0x06:
        if (sp < 2) return end(2);
        if (sp >= 256) return end(3);
        stack[sp] = stack[sp - 2]; sp++; break;
      case 0x07: { // ROT ( a b c -- b c a )
        if (sp < 3) return end(2);
        const a = stack[sp - 3];
        stack[sp - 3] = stack[sp - 2]; stack[sp - 2] = stack[sp - 1]; stack[sp - 1] = a; break;
      }
      case 0x17: // NEG (wraps at INT_MIN)
        if (sp < 1) return end(2);
        stack[sp - 1] = -stack[sp - 1] | 0; break;
      case 0x1b:
        if (sp < 1) return end(2);
        stack[sp - 1] = ~stack[sp - 1]; break;
      case 0x30: case 0x31: case 0x32: { // JMP, JZ, JNZ: target = next + offset
        next = pc + 3;
        if (next > n) return end(9);
        const rel = ((prog[pc + 1] | (prog[pc + 2] << 8)) << 16) >> 16;
        let take = op === 0x30;
        if (!take) {
          if (sp < 1) return end(2);
          take = op === 0x31 ? stack[--sp] === 0 : stack[--sp] !== 0;
        }
        if (take) next += rel;
        break;
      }
      case 0x33: // CALL: absolute target
        next = pc + 3;
        if (next > n) return end(9);
        if (csp >= 64) return end(7);
        calls[csp++] = next; next = prog[pc + 1] | (prog[pc + 2] << 8); break;
      case 0x34:
        if (csp === 0) return end(8);
        next = calls[--csp]; break;
      case 0x40: {
        if (sp < 1) return end(2);
        const addr = stack[sp - 1];
        if (addr < 0 || addr > 255) return end(6);
        stack[sp - 1] = mem[addr]; break;
      }
      case 0x41: { // STORE ( v addr -- )
        if (sp < 2) return end(2);
        const addr = stack[sp - 1];
        if (addr < 0 || addr > 255) return end(6);
        mem[addr] = stack[sp - 2]; sp -= 2; break;
      }
      case 0x50: { // PRINT: decimal ASCII only
        if (sp < 1) return end(2);
        const s = String(stack[sp - 1]);
        if (olen + s.length > 65536) return end(11); // writes none of it
        sp--;
        for (let i = 0; i < s.length; i++) out[olen++] = s.charCodeAt(i);
        break;
      }
      case 0x51:
        if (sp < 1) return end(2);
        if (olen >= 65536) return end(11);
        out[olen++] = stack[--sp] & 255; break;
      case 0x52: // IN: -1 past the end
        if (sp >= 256) return end(3);
        stack[sp++] = ipos < input.length ? input[ipos++] : -1; break;
      case 0x53: // EXIT: low byte is the code
        if (sp < 1) return end(2);
        return end(stack[--sp] & 255);
      default: return end(5);
    }
    pc = next;
  }
}

const read = (p) => { try { return readFileSync(p); } catch { return []; } };
const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const id of readdirSync(I).sort()) {
  const r = run(read(join(I, id, 'program.bin')), read(join(I, id, 'input.bin')));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'stdout.bin'), r.out);
  writeFileSync(join(O, id, 'exit.txt'), r.code + '\n');
}
