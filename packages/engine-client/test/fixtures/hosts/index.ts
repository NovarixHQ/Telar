import nightly20261007 from "./0.1.0-nightly.20261007.1.json";

export type RecordedAnswer = { status: number; body: unknown };
export type RecordedHost = { version: string; answers: Record<string, RecordedAnswer> };

export const RECORDED_HOSTS: RecordedHost[] = [{ version: "0.1.0-nightly.20261007.1", answers: nightly20261007 }];

export function recordedFetch(host: RecordedHost): typeof globalThis.fetch {
  const answer = async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const recorded = host.answers[`${url.pathname.replace(/^\/api\//, "/v2/")}${url.search}`];
    if (!recorded) return Response.json({ error: { code: "not_found", message: "Not found." } }, { status: 404 });
    return Response.json(recorded.body, { status: recorded.status });
  };
  return answer as typeof globalThis.fetch;
}
