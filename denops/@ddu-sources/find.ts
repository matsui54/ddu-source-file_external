import {
  BaseSource,
  Item,
} from "https://deno.land/x/ddu_vim@v0.1.0/types.ts#^";
import { Denops, fn } from "https://deno.land/x/ddu_vim@v0.1.0/deps.ts#^";
import { relative, resolve } from "https://deno.land/std@0.120.0/path/mod.ts";
import { ActionData } from "https://deno.land/x/ddu_kind_file@v0.1.0/file.ts#^";

type Params = {
  path: string;
  cmd: string[];
};

async function getOutput(cmds: string[]): Promise<string[]> {
  try {
    const proc = Deno.run({
      cmd: cmds,
      stdout: "piped",
      stderr: "piped",
    });
    const [status, stdout, stderr] = await Promise.all([
      proc.status(),
      proc.output(),
      proc.stderrOutput(),
    ]);
    proc.close();

    if (!status.success) {
      console.error(stderr);
      return [];
    }
    return (new TextDecoder().decode(stdout)).split("\n");
  } catch (e: unknown) {
    console.error(e);
    return [];
  }
}

export class Source extends BaseSource<Params> {
  kind = "file";

  gather(args: {
    denops: Denops;
    sourceParams: Params;
  }): ReadableStream<Item<ActionData>[]> {
    return new ReadableStream({
      async start(controller) {
        const maxItems = 20000;

        const tree = async (root: string) => {
          let items: Item<ActionData>[] = [];
          const paths = await getOutput([...args.sourceParams.cmd, root]);
          paths.map((path) => {
            items.push({
              word: relative(root, path),
              action: {
                path: path,
              },
            });
            if (items.length > maxItems) {
              // Update items
              controller.enqueue(items);
              // Clear
              items = [];
            }
          });
          return items;
        };

        let dir = args.sourceParams.path;
        if (dir == "") {
          dir = await fn.getcwd(args.denops) as string;
        }

        controller.enqueue(
          await tree(resolve(dir, dir)),
        );

        controller.close();
      },
    });
  }

  params(): Params {
    return {
      path: "",
      cmd: [],
    };
  }
}