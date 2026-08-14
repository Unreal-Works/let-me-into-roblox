import { getRoblosecurity, createApiKey } from ".";

console.log(
  `Your ROBLOSECURITY cookie has ${getRoblosecurity()?.length} characters,`,
);
console.log(
  `and your API key has ${(await createApiKey({ roblosecurity: getRoblosecurity() })).apiKey.length} characters!`,
);
