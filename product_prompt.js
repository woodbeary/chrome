export function createProductPrompt(context) {
  return `First, analyze the provided image and identify:
1. Product type (hoodie, hat, or shirt)
2. Any logos, designs, or text present
3. Color and style details

Image URL: ${context.imageUrl}

Product Details (for context only - don't copy directly):
- Hoodies: Premium 420g weight, no drawcord design, double layer hood, blind stitch seams
- Hats: 100% cotton ripstop, 5-panel, rope detail, snapback
- Shirts: 100% cotton, 8.2oz heavyweight, preshrunk, side seamed

Key Points:
- I personally design and wear these products
- Ships from Huntington Beach, USA
- Free shipping included
- Limited drops (50 units max)
- Direct sales through X shop
- Premium quality at fair price
- Quick shipping (1-5 days domestic)
- DM for questions, tracking sent via DM
- Took forever to find the right supplier
- No cheap materials, only premium heavyweight stuff
- Made to order, ships directly to you

Special Cases:
- If design includes "X", MUST name it "not a x [product]" (e.g., "not a x hoodie") (because its unofficial merch)
- X is formerly twitter in this context
- For X designs, emphasize the unofficial/independent nature subtly
- Keep political designs subtle but impactful
- Focus on exclusivity and limited availability
- Always use product-specific details (420g for hoodies, ripstop for hats, 8.2oz for shirts)

Title Rules:
- Must be lowercase
- Max 4 words
- For X designs: always "not a x [product]"
- For other designs: "[design] [product]" or "premium [product]"

Description Rules:
- Must include 5-6 natural sentences that build trust
- Structure:
  1. Personal context hook
  2. Quality details (materials, supplier)
  3. Customer experience promise
  4. Shipping/support specifics
  5. Trust-building closer
  6. Call to action

Trust Building Elements:
- Specific shipping times ("ships in 3-7 days across usa")
- Support details ("dm anytime with questions")
- Quality guarantees ("premium materials only")
- Return policy hints ("satisfaction guaranteed")
- Tracking promise ("tracking number in dms")

Style Guide:
- Balance casual tone with professional reliability
- Include concrete details about shipping/support
- Add reassuring phrases like:
  • "ships in 3-7 days anywhere in usa"
  • "tracking number sent right to ur dms"
  • "dm me anytime with questions"
  • "premium shipping included"
  • "quality guaranteed or money back"
  • "made in small batches to ensure quality"

  Return ONLY a JSON object with this structure:  
{
  "title": "not a x hoodie",
  "description": "been perfecting this design for months - 420g premium weight from my trusted supplier in huntington beach. quality actually matters to me so im doing everything right - premium materials only. ships in 3-7 days anywhere in usa with tracking number sent to ur dms. satisfaction guaranteed or money back, just dm me. small batch dropping today + free premium shipping included"
}

Style Examples:
- "took months to get this hoodie exactly right - 420g weight from my premium supplier in huntington beach. using only the best materials cause that's what you deserve. ships in 3-7 days anywhere in usa, tracking number straight to ur dms. quality guaranteed or money back, just dm me anytime. small batch + free premium shipping"

- "spent forever finding the perfect ripstop hat supplier in california - quality you can actually feel. premium materials only, no shortcuts taken. ships in 3-7 days across usa with tracking sent to ur dms. not happy? just dm me and ill make it right. small batch dropping now + free shipping"

- "this tee is exactly what i wanted - 8.2oz premium cotton from my trusted supplier in huntington beach. quality checked personally cause details matter. ships in 3-7 days usa-wide, tracking number in ur dms. satisfaction guaranteed, just dm me with any questions. small batch + free premium shipping included"`;
}