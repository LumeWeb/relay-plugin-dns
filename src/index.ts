import type {
  Plugin,
  PluginAPI,
  RPCResponse,
  RPCRequest,
} from "@lumeweb/relay";
import bns from "bns";
import { isIp } from "@lumeweb/libresolver";
const { StubResolver, RecursiveResolver } = bns;

const resolverOpt = {
  tcp: true,
  inet6: false,
  edns: true,
  dnssec: true,
};

const globalResolver = new RecursiveResolver(resolverOpt);
globalResolver.hints.setDefault();
globalResolver.open();

async function resolveNameServer(ns: string): Promise<string | boolean> {
  if (isIp(ns)) {
    return ns;
  }
  let result = await getDnsRecords(ns, "A");

  if (result.length) {
    return result[0];
  }

  return false;
}

async function getDnsRecords(
  domain: string,
  type: string,
  authority: boolean = false,
  resolver = globalResolver
): Promise<string[]> {
  let result;

  try {
    result = await resolver.lookup(domain, type);
  } catch (e) {
    return [];
  }

  let prop = authority ? "authority" : "answer";

  if (!result || !result[prop].length) {
    return [];
  }

  return result[prop].map(
    (item: object) =>
      // @ts-ignore
      item.data.address ?? item.data.target ?? item.data.ns ?? null
  );
}

const plugin: Plugin = {
  name: "dns",
  async plugin(api: PluginAPI): Promise<void> {
    api.registerMethod("resolve", {
      cacheable: true,
      async handler(request: RPCRequest): Promise<RPCResponse> {
        debugger;
        let dnsResults: string[] = [];
        let domain = request.data.domain;
        let ns = request.data.nameserver;
        let recordTypes = request.data.type
          ? [request.data.type]
          : ["CNAME", "A"];

        let dnsResolver = ns ? new StubResolver(resolverOpt) : globalResolver;

        if (dnsResolver !== globalResolver) {
          await dnsResolver.open();
        }

        if (ns) {
          let nextNs = ns;
          let prevNs = null;

          while (nextNs) {
            nextNs = await resolveNameServer(nextNs);
            if (!nextNs) {
              nextNs = prevNs;
            }

            dnsResolver.setServers([nextNs]);

            if (nextNs === prevNs) {
              break;
            }
            let result = await getDnsRecords(domain, "NS", true, dnsResolver);
            prevNs = nextNs;
            nextNs = result.length ? result[0] : false;
          }
        }

        for (const queryType of recordTypes) {
          let result = await getDnsRecords(
            domain,
            queryType,
            false,
            dnsResolver
          );

          if (result) {
            dnsResults = dnsResults.concat(result);
          }
        }
        if (dnsResolver !== globalResolver) {
          await dnsResolver.close();
        }

        dnsResults = dnsResults.filter(Boolean);

        if (dnsResults.length) {
          return { data: dnsResults.shift() };
        }

        throw new Error(`${domain} not found`);
      },
    });
  },
};

export default plugin;
