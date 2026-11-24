# Food and workout API

The hosted app exposes an optional HTTPS API for a connector to log meals or workouts to a specific account. Start with [the OpenAPI definition](../public/food-records.openapi.json). Replace https://example.com in the definition with your deployment URL before importing it.

## Setup

1. Create or sign in to the Cut Log account you want the connector to use. Copy its user UUID from Supabase Authentication.
2. Run `supabase/schema.sql` and `supabase/agent.sql` in your Supabase project. Set `FITNESS_AGENT_ENABLED=1` on the server and redeploy.
3. Generate a separate credential for each connector.

```sh
node scripts/create-agent-token.mjs YOUR_SUPABASE_USER_UUID "My connector"
```

The script prints SQL to register or revoke the credential. Run the registration SQL in your Supabase project and enter the raw token in the connector's secure credential field. Tokens expire after 180 days by default.

For Muse, see the [custom connector documentation](https://www.meta.com/help/superintelligence/1687253048996149/). Give the connector the HTTPS URL and the OpenAPI definition. The instructions below describe the app's confirmation flow.

> Use the Cut Log API to read and write food records. Use Pacific Time for dates. Nutrition values are totals for the amount eaten. Mark estimates as estimate and use a range when possible. For a photo, preview the meal, show the food, weight, calories, and macros to the user, and wait for confirmation before saving. Use the original payload and idempotency key when confirming. For edits and deletes, read the current record revision first. If duplicate_meal is returned, check whether the user ate another meal or retried the first one.

## Requests

Use `Authorization: Bearer <connector-token>` on requests. Include `Idempotency-Key` on POST, PATCH, and DELETE. Use a URL-safe value of 16–128 characters, such as a UUID. Reuse it when retrying the exact same action. List responses return `next_cursor` for pagination.

| Method | Path | Result |
| --- | --- | --- |
| GET | /api/v1/food-records?date=2026-11-22&limit=50 | List a day's food records. Defaults to the current date in Pacific Time. |
| POST | /api/v1/food-records | Add a meal with 1–24 items. |
| GET | /api/v1/food-records/{id} | Get one food record and its revision. |
| PATCH | /api/v1/food-records/{id} | Update a food record. Send its revision in If-Match. |
| DELETE | /api/v1/food-records/{id} | Delete a food record. Send its revision in If-Match. |
| POST | /api/v1/workouts | Add a workout with a credential that can log workouts. |

A meal payload can contain one or more foods.

```json
{
  "date": "2026-11-22",
  "meal": "lunch",
  "input_type": "text",
  "items": [
    {"name":"Cooked white rice","amount":150,"unit":"g","kcal":195,"protein_g":4,"carbs_g":42.3,"fat_g":0.4,"source":"estimate"},
    {"name":"Whey protein","amount":1,"unit":"scoop","grams":31,"kcal":120,"protein_g":24,"carbs_g":3,"fat_g":1.5,"source":"label"}
  ]
}
```

- Set meal to breakfast, lunch, dinner, or snack. Each item needs an amount, a unit, and all four nutrition totals. Grams are optional unless needed to establish a portion. If the unit is g, an explicit grams value must match amount. The source is estimate, label, or manual. An estimate can include range.low and range.high with the same four nutrition fields.
- For a photo, set input_type to photo and source to estimate. Submit preview: true and show the result to the user. Once they confirm, use the same payload and idempotency key, remove preview, and add confirmed: true. The matching preview expires after 20 minutes. The API accepts the interpreted food data, while the original photo stays with the connector.
- PATCH takes an item with the full nutrition fields and optional date and meal. Deleting or editing requires the current revision in If-Match, for example "1".
- A new write returns 201. An exact replay returns 200 with replayed: true. A key reused for different data returns idempotency_key_reused. An identical meal within ten minutes returns duplicate_meal. For a second meal, use a fresh key and allow_duplicate: true.
- On revision_conflict, reload the record before retrying an edit. A 401 indicates an invalid or expired credential, 429 indicates a limit, and 503 indicates the service is disabled or unavailable. The app refreshes cloud records while open.

## Workout requests

Enable the can_log_workouts permission for the connector credential before using POST /api/v1/workouts. As for meals, supply the bearer credential and an idempotency key. A strength workout can specify muscle groups, exercises, or both.

```json
{
  "kind": "strength",
  "muscles": ["chest"],
  "exercises": [
    {"name":"Bench press","muscle":"chest","weight":60,"unit":"lb","sets":4,"reps":8}
  ]
}
```

For a quick chest workout entry, send {"kind":"strength","muscles":["chest"]}. Other kinds are basketball, incline, treadmill, and other. The date, minutes, and note are optional. With no date, the current date in Pacific Time is used. You can inspect, edit, and remove workouts in the app.

## Local MCP bridge

The stdio bridge forwards calls to the same REST API. Configure a compatible client with the path to `scripts/mcp-stdio.mjs` and supply `CUT_LOG_URL` and `CUT_LOG_TOKEN` in its environment.

```json
{
  "mcp_servers": {
    "cut-log": {
      "transport": "stdio",
      "command": "node",
      "args": ["/path/to/cut-log/scripts/mcp-stdio.mjs"],
      "env": {
        "CUT_LOG_URL": "<deployment-url>",
        "CUT_LOG_TOKEN": "<connector-token>"
      }
    }
  }
}
```
