# Tiny Stack VM

A dependency-free interpreter for make.fun's tiny stack ISA v1, in one
file, `main.ts`, written from the kit's ISA.md. All 40 opcodes:
stack shuffles, wrapping signed 32-bit arithmetic (signed and unsigned
division/remainder), jumps, calls, 256 words of memory, PRINT/PUTC/IN/EXIT.
Ten traps, each with its own exit code: 2 underflow, 3 overflow, 4 divide
by zero, 5 bad opcode, 6 bad address, 7 call overflow, 8 bare RET,
9 out of range, 10 step limit, 11 output limit.

Node 22: `node /bot/main.ts`. It reads `<id>/program.bin` and
`<id>/input.bin` under /input ($MAKEFUN_INPUT_DIR) and writes
`<id>/stdout.bin` and `<id>/exit.txt` under /output ($MAKEFUN_OUTPUT_DIR).
Example: bytes `01 48 51 01 69 51 00` print "Hi" and halt, exit 0.

Limits: 1,000,000 steps and 65,536 output bytes per program.
Deterministic; no clock or network.
