import {
  BaseSource,
  Item,
} from "https://deno.land/x/ddu_vim@v0.12.2/types.ts";
import { Denops, fn } from "https://deno.land/x/ddu_vim@v0.12.2/deps.ts";
import { ActionData } from "https://deno.land/x/ddu_kind_file@v0.2.0/file.ts";
import { relative, resolve } from "https://deno.land/std@0.125.0/path/mod.ts";
import { BufReader } from "https://deno.land/std@0.125.0/io/buffer.ts";

type Params = {
  cmd: string[];
  path: string;
  updateItems: number;
};

async function* iterLine(reader: Deno.Reader): AsyncIterable<string> {
  const buffered = new BufReader(reader);
  while (true) {
    const line = await buffered.readString("\n");
    if (!line) {
      break;
    }
    yield line;
  }
}

export class Source extends BaseSource<Params> {
  kind = "file";

  gather(args: {
    denops: Denops;
    sourceParams: Params;
  }): ReadableStream<Item<ActionData>[]> {
    const { denops, sourceParams } = args;
    return new ReadableStream({
      async start(controller) {
        const tree = async (root: string) => {
          let items: Item<ActionData>[] = [];
          const updateItems = sourceParams.updateItems;

          try {
            const proc = Deno.run({
              cmd: [...sourceParams.cmd, root],
              stdout: "piped",
              stderr: "piped",
              cwd: root,
            });

            for await (const line of iterLine(proc.stdout)) {
              const path = line.trim();
              if (!path.length) continue;
              const fullPath = resolve(root, path);
              items.push({
                word: relative(root, fullPath),
                action: {
                  path: fullPath,
                },
              });
              if (items.length >= updateItems) {
                controller.enqueue(items);
                items = [];
              }
            }

            const [status, stderr] = await Promise.all([
              proc.status(),
              proc.stderrOutput(),
            ]);
            proc.close();

            if (!status.success) {
              console.error(new TextDecoder().decode(stderr));
            }
          } catch (e: unknown) {
            console.error(e);
          }
          return items;
        };

        let dir = await fn.expand(denops, sourceParams.path) as string;
        if (dir == "") {
          dir = await fn.getcwd(denops) as string;
        }

        if (args.sourceParams.cmd.length > 0) {
          controller.enqueue(
            await tree(resolve(dir, dir)),
          );
        }

        controller.close();
      },
    });
  }

  params(): Params {
    return {
      cmd: [],
      path: "",
      updateItems: 30000,
    };
  }
}
