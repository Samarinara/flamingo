; Count down from 5, writing each value to an output port, then halt.
; Assemble with:
;   python3 -I tools/asm.py examples/tiny8.toml examples/count8.s --listing
        .equ    PORT, 0xf0      ; output port in the zero page

start:  lda     #5
loop:   sta     PORT            ; known and < 0x100: 2-byte zero-page form
        dec                     ; pseudo-instruction for sub #1
        bne     loop
        sta     done            ; defined later: 3-byte absolute form
        jsr     show
        hlt

show:   lda     message         ; a backward reference above 0xff: absolute form
        ret

done:   .byte   0
message: .ascii "hi"
