# ddu-source-find
File source using external command for ddu.vim

# Example
```vim
call ddu#custom#patch_global('sourceParams', {
      \ 'find': {'cmd': ['fd', '.', '-H', '-E', '__pycache__', '-t', 'f']}
      \ })
```
