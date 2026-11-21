# Sum the words in `table` into a0, then spin. Assemble with:
#   python3 -I tools/asm.py isa-template.toml examples/sum.s -o sum.bin --listing
        .equ    COUNT, 4

start:  lui     t0, table & ~0xfff      # t0 = address of table (upper part)
        addi    t0, t0, table & 0xfff   #      ... plus lower part
        addi    t1, zero, COUNT         # t1 = words left
        mv      a0, zero                # a0 = running sum
loop:   lw      t2, 0(t0)
        add     a0, a0, t2
        addi    t0, t0, 4
        addi    t1, t1, -1
        beq     t1, zero, done
        j       loop
done:   sw      a0, 0(t0)               # t0 now points at result
        j       .                       # spin forever

        .align  4
table:  .word   10, 20, 30, 40
result: .word   0
msg:    .asciz  "done"
