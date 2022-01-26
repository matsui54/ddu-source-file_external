# ddu-source-file_external
File source using external command for ddu.vim

# Example
```vim
call ddu#custom#patch_global('sourceParams', {
      \ 'file_external': {'cmd': ['fd', '.', '-H', '-E', '__pycache__', '-t', 'f']}
      \ })
```
