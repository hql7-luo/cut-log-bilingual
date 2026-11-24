# Cut Log

Cut Log is a mobile-first food, workout, and weight tracker in English and Simplified Chinese. Type a meal in your own words, review the portions, and see your nutrition and training alongside your weight trend.

## Try it

Install Node.js 22 or newer and run the commands below.

```sh
npm install
npm run dev
```

Open [English](http://localhost:3000/?lang=en) or [简体中文](http://localhost:3000/?lang=zh). On mobile, the language switch is at the top. On desktop, it is in the sidebar. Your choice stays on the device, and the two interfaces share the same records.

Try **Log Food** with “For lunch I had 200 g of rice and two eggs.” Choose **Parse and preview**, check the amounts, and save the meal. To start with an empty journal, open **Settings → Clear demo data and start logging**. Use **Settings → Profile** and **Nutrition and Weight Goals** to enter your own information and targets.

For a standalone browser demo, run `npm run build:demo` and open `demo.html`. Local logging works without a cloud account.

## What you can track

- **Meals.** Parse English or Chinese text, adjust portions, search the built-in food list, or enter a package label. Save frequent foods for reuse. Dictation is available when the browser supports it.
- **Workouts.** Track strength sets and reps, basketball, and cardio. Reuse workout templates and review exercise history.
- **Daily energy.** Compare logged intake with a calorie budget and estimated expenditure. A logged training duration takes precedence over a default when previewing today's selected activity.
- **Progress.** View daily details and weekly, monthly, or quarterly calorie summaries. Track weight trends, export CSV, and review goal adjustments before applying them.

Food portions and energy expenditure are estimates. Log dates currently use Pacific Time. The initial nutrition and training targets are examples.

## Optional cloud setup

To host Cut Log, deploy the source as a Next.js project. Set environment variables from [.env.example](.env.example) in your host's settings, or copy the file to `.env.local` for local development.

| Feature | Setup |
| --- | --- |
| Email accounts and device sync | Run [supabase/schema.sql](supabase/schema.sql) in your Supabase project. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Set the app URL and allowed redirects in Supabase Authentication. |
| Online USDA FoodData Central search | Configure sync and set `USDA_API_KEY` on the server. |
| Online text parsing | Configure sync and set `AI_API_KEY`, `AI_MODEL`, and optionally `AI_BASE_URL` for a compatible HTTPS provider. |
| Meal photo analysis | Configure sync and set `AI_API_KEY` and `AI_VISION_MODEL`. The configured vision provider receives the photo. |
| Meal and workout API | Follow the [API and connector guide](docs/agent-api.md) to enable the service and issue a scoped credential. |

Each signed-in account has its own cloud records. Guest records stay in their browser. Images sent for analysis become editable meal drafts. Saving a meal writes the confirmed food data. Keep provider and connector keys in server or connector settings.

## Checks

```sh
npm run check
npm test
npm run build
```
