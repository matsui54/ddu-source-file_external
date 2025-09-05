import type { Item, SourceOptions } from "@shougo/ddu-vim/types";
import { BaseSource } from "@shougo/ddu-vim/source";
import type { ActionData } from "@shougo/ddu-kind-file";

import type { Denops } from "@denops/std";
import * as fn from "@denops/std/function";

import { relative } from "@std/path/relative";
import { resolve } from "@std/path/resolve";
import { abortable } from "@std/async/abortable";
import { TextLineStream } from "@std/streams/text-line-stream";

const enqueueSize1st = 1000;

type Params = {
  cmd: string[];
  updateItems: number;
};

async function* iterLine(r: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const lines = r
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new TextLineStream());

  for await (const line of lines) {
    if ((line as string).length) {
      yield line as string;
    }
  }
}

async function tryGetStat(path: string): Promise<Deno.FileInfo | null> {
  // Note: Deno.stat() may fail
  try {
    const stat = await Deno.stat(path);
    if (stat.isDirectory || stat.isFile || stat.isSymlink) {
      return stat;
    }
  } catch (_: unknown) {
    // Ignore stat exception
  }

  return null;
}

export class Source extends BaseSource<Params> {
  override kind = "file";

  gather(args: {
    denops: Denops;
    sourceOptions: SourceOptions;
    sourceParams: Params;
  }): ReadableStream<Item<ActionData>[]> {
    const abortController = new AbortController();
    const { denops, sourceOptions, sourceParams } = args;
    return new ReadableStream({
      async start(controller) {
        let root = await fn.fnamemodify(
          denops,
          sourceOptions.path,
          ":p",
        ) as string;
        if (root == "") {
          root = await fn.getcwd(denops) as string;
        }

        if (!args.sourceParams.cmd.length) {
          return;
        }

        let items: Item<ActionData>[] = [];
        const enqueueSize2nd = sourceParams.updateItems;
        let enqueueSize = enqueueSize1st;
        let numChunks = 0;

        const proc = new Deno.Command(
          sourceParams.cmd[0],
          {
            args: sourceParams.cmd.slice(1),
            stdout: "piped",
            stderr: "piped",
            cwd: root,
          },
        ).spawn();

        if (!proc || proc.stdout === null) {
          controller.close();
          return;
        }
        try {
          for await (
            const line of abortable(
              iterLine(proc.stdout),
              abortController.signal,
            )
          ) {
            const path = line.trim();
            if (!path.length) continue;

            const fullPath = resolve(root, path);
            const stat = await tryGetStat(fullPath);
            if (!stat) {
              continue;
            }

            items.push({
              word: relative(root, fullPath) + (stat.isDirectory ? "/" : ""),
              action: {
                path: fullPath,
                isDirectory: stat.isDirectory,
                isLink: stat.isSymlink,
              },
              status: {
                size: stat.size,
                time: stat.mtime?.getTime(),
              },
              isTree: stat.isDirectory,
              treePath: fullPath,
            });
            if (items.length >= enqueueSize) {
              numChunks++;
              if (numChunks > 1) {
                enqueueSize = enqueueSize2nd;
              }
              controller.enqueue(items);
              items = [];
            }
          }
          if (items.length) {
            controller.enqueue(items);
          }
        } catch (e: unknown) {
          proc.kill("SIGTERM");

          if (e instanceof Error && e.name.includes("AbortReason")) {
            // Ignore AbortReason errors
          } else {
            console.error(e);
          }
        } finally {
          const status = await proc.status;
          if (!status.success) {
            for await (
              const line of abortable(
                iterLine(proc.stderr),
                abortController.signal,
              )
            ) {
              console.error(line);
            }
          }
          controller.close();
        }
      },

      cancel(reason): void {
        abortController.abort(reason);
      },
    });
  }

  params(): Params {
    return {
      cmd: [],
      updateItems: 100000,
    };
  }
}
