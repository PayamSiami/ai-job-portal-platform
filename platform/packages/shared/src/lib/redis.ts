import { createClient, type RedisClientType } from "redis";
import { env } from "./config.js";
import {
  EVENT_DLQ,
  EVENT_STREAM,
  EventSchemas,
  type EventHandler,
} from "../events/index.js";

// ------------------------------------------------------------
// Redis helpers: a lazy shared client for commands, a dedicated
// client for the blocking event-consumer loop, event publishing
// on a single stream ("portal:events") and refresh-token JTI
// storage used by the auth-service.
// ------------------------------------------------------------

let commandClient: RedisClientType | null = null;
let consumerClient: RedisClientType | null = null;

function redisUrl(): string {
  return env("REDIS_URL", "redis://localhost:6379");
}

export async function getRedis(): Promise<RedisClientType> {
  if (!commandClient) {
    commandClient = createClient({ url: redisUrl() });
    commandClient.on("error", (err) => console.error("[redis]", err.message));
    await commandClient.connect();
  }
  return commandClient;
}

export async function closeRedis(): Promise<void> {
  await Promise.allSettled([
    commandClient?.quit(),
    consumerClient?.quit(),
  ]);
  commandClient = null;
  consumerClient = null;
}

// ------------------------- Events -------------------------

/**
 * Publish a domain event. Payload is validated against the shared
 * zod contract before it leaves the process.
 */
export async function publishEvent(
  type: keyof typeof EventSchemas | string,
  payload: unknown,
): Promise<void> {
  const schema = EventSchemas[type as keyof typeof EventSchemas];
  if (schema) {
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new Error(`Invalid payload for event ${type}: ${parsed.error.message}`);
    }
  }
  const client = await getRedis();
  await client.xAdd(EVENT_STREAM, "*", {
    type: String(type),
    data: JSON.stringify(payload),
  });
}

/**
 * Consume events as part of a consumer group.
 * - Unknown event types are skipped (forward compatibility).
 * - Handler failures go to a DLQ stream and are ACKed so a single
 *   bad event cannot wedge the group (documented tradeoff).
 */
export async function startEventConsumer(
  group: string,
  handler: EventHandler,
): Promise<void> {
  if (!consumerClient) {
    consumerClient = createClient({ url: redisUrl() });
    consumerClient.on("error", (err) => console.error("[redis-consumer]", err.message));
    await consumerClient.connect();
  }
  const client = consumerClient;
  const consumer = `${group}-${process.pid}`;

  try {
    await client.xGroupCreate(EVENT_STREAM, group, "0", { MKSTREAM: true });
    console.log(`[events] created group ${group}`);
  } catch (err) {
    if (!(err instanceof Error && err.message.includes("BUSYGROUP"))) throw err;
  }

  console.log(`[events] consumer ${consumer} listening on ${EVENT_STREAM}`);

  const run = async (): Promise<void> => {
    for (;;) {
      try {
        const response = await client.xReadGroup(
          group,
          consumer,
          [{ key: EVENT_STREAM, id: ">" }],
          { COUNT: 10, BLOCK: 5000 },
        );
        if (!response) continue;
        for (const stream of response) {
          for (const message of stream.messages) {
            const id = String(message.id);
            try {
              const fields = message.message as Record<string, string>;
              const type = fields["type"];
              const data = JSON.parse(fields["data"] ?? "{}");
              if (type && EventSchemas[type as keyof typeof EventSchemas]) {
                await handler(type, data, id);
              } else if (type) {
                console.warn(`[events] skipped unknown event type: ${type}`);
              }
              await client.xAck(EVENT_STREAM, group, id);
            } catch (err) {
              console.error(`[events] handler failed for ${id}:`, err);
              await client
                .xAdd(EVENT_DLQ, "*", {
                  originalId: id,
                  error: err instanceof Error ? err.message : String(err),
                })
                .catch(() => undefined);
              await client.xAck(EVENT_STREAM, group, id);
            }
          }
        }
      } catch (err) {
        console.error("[events] read loop error:", err);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  };

  void run();
}

// ------------------------- Refresh-token store -------------------------
// jti -> family mapping with TTL. Used by the auth-service to accept
// only issued refresh tokens and to revoke a family on suspected reuse.

const rtKey = (fam: string, jti: string) => `rt:${fam}:${jti}`;
const famKey = (fam: string) => `rtfam:${fam}`;

export async function rememberRefreshToken(fam: string, jti: string, ttlSec: number): Promise<void> {
  const client = await getRedis();
  await client.set(rtKey(fam, jti), "1", { EX: ttlSec });
  await client.sAdd(famKey(fam), jti);
  await client.expire(famKey(fam), ttlSec);
}

export async function refreshJtiValid(fam: string, jti: string): Promise<boolean> {
  const client = await getRedis();
  return (await client.get(rtKey(fam, jti))) === "1";
}

export async function revokeRefreshToken(fam: string, jti: string): Promise<void> {
  const client = await getRedis();
  await client.del(rtKey(fam, jti));
}

export async function revokeRefreshFamily(fam: string): Promise<void> {
  const client = await getRedis();
  const jtis = await client.sMembers(famKey(fam));
  if (jtis.length > 0) {
    await client.del(jtis.map((jti) => rtKey(fam, jti)));
  }
  await client.del(famKey(fam));
}
