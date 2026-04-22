# Contributing to WordDrop

## Adding Word Packs

### YAML Format

```yaml
meta:
  id: my-pack          # unique ID, no spaces
  name: My Word Pack   # display name
  icon: ⭐             # emoji icon
  default_image_size: 200

words:
  - word: apple
    emoji: 🍎
    image: apple.gif          # optional: put file in words/images/
    difficulty: 2             # 1=short (3-4 letters), 2=medium (5-6), 3=long (7+)
    translations:
      zh: 苹果
      ja: りんご
      es: manzana
      fr: pomme
    tags: [fruit]
```

### Image files

Place image files in `words/images/`. Supported formats: GIF, WebP, PNG, SVG.
If no image is provided, the game fetches from Giphy API automatically.

---

## AI-Assisted Word Pack Generation

Copy the prompt below into Claude, ChatGPT, or any AI assistant:

```
Please generate a WordDrop word pack YAML file for these words:
[paste your word list here]

Use this exact format:

meta:
  id: [choose-a-unique-id]
  name: [Pack Name]
  icon: [one emoji]
  default_image_size: 200

words:
  - word: [english word, lowercase]
    emoji: [most representative emoji]
    difficulty: [1 if 3-4 letters / 2 if 5-6 letters / 3 if 7+ letters]
    translations:
      zh: [Chinese translation]
      ja: [Japanese translation]
      es: [Spanish translation]
      fr: [French translation]
    tags: [[category tag]]

Rules:
- word must be lowercase
- Pick the single most representative emoji
- difficulty based purely on letter count
- translations should be the most common, simple translation
- tags: use one of: fruit, animal, food, drink, nature, transport, body, color, number, clothing, furniture, tool, place, emotion
```

Save the output as a `.yaml` file and upload it in the game settings, or submit a pull request.

---

## Pull Request Guidelines

1. One pack per PR is ideal
2. Test your YAML by uploading it in the game before submitting
3. Word lists should be thematically coherent
4. Minimum 10 words per pack
