# Amplifier AHP client kit

Build JavaScript clients for an Agent Host Protocol (AHP) server, or submit work
from the included command-line client. The kit provides connection recovery,
confirmed resource state and private storage for drafts and request records.
The host runs the agent; this package does not load an agent runtime in the client.

## Get started with the command-line client

Use Node.js 22.16+ and an existing AHP host with an agent configured. From a checkout:

```sh
git clone https://github.com/microsoft/amplifier-ahp-client-kit.git
cd amplifier-ahp-client-kit
npm ci
node src/cli.js --help
```

Put your request in `request.txt`, then submit it to your host. The workspace path
is on the host, and the token file must remain private:

```sh
node src/cli.js run --server wss://your-host/ahp \
  --token-file host-token.txt --workspace /host/work/project \
  --prompt-file request.txt --command first-input
```

Inspect the same command if the connection or wait ends before its result arrives:

```sh
node src/cli.js inspect --server wss://your-host/ahp \
  --token-file host-token.txt --command first-input --output json
```

Reusing a command ID observes the original request; it does not send it again.
Ending the client does not cancel host work. Interactive approvals must be handled
in an interactive client. Prompts use the host's real configured provider and model.

## Use the library

Install a local checkout into your client project with
`npm install /absolute/path/to/amplifier-ahp-client-kit`. The package exports:

| Entry point | Use |
| --- | --- |
| `@amplifier/ahp-client-kit` | AHP connections, recovery, confirmed resources and durable intent records |
| `@amplifier/ahp-client-kit/indexeddb` | Browser storage scoped to host, account and tab |
| `@amplifier/ahp-client-kit/headless` | Programmatic noninteractive requests and inspection |
| `@amplifier/ahp-client-kit/file-storage` | File-backed private request storage |

Start with the [public TypeScript interfaces](src/index.d.ts) or
[headless interfaces](src/headless.d.ts). Applications own rendering, reconnect
timing, storage limits and authorization. Buffer events during recovery before
applying them to confirmed state, and preserve uncertain requests without replay.

The [client contract](contracts/client-kit.v1.md) describes integration obligations;
[AHP](https://microsoft.github.io/agent-host-protocol/) defines the wire protocol.
File-storage durability is currently qualified on POSIX systems.

## Contributing

Most contributions require you to agree to a
Contributor License Agreement (CLA) declaring that you have the right to, and actually do, grant us
the rights to use your contribution. For details, visit [Contributor License Agreements](https://cla.opensource.microsoft.com).

When you submit a pull request, a CLA bot will automatically determine whether you need to provide
a CLA and decorate the PR appropriately (e.g., status check, comment). Simply follow the instructions
provided by the bot. You will only need to do this once across all repos using our CLA.

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or
contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
