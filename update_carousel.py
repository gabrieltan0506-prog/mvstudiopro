import re

with open('client/src/components/HomeFeatureCarousel.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Extract CAROUSEL_CARDS array
match = re.search(r'const CAROUSEL_CARDS = \[(.*?)\];\n\nconst WORKFLOW_LINKS', content, re.DOTALL)
if match:
    cards_str = match.group(1)
    # Split into individual cards using basic parsing
    # This is a bit tricky with nested brackets, but we can split by "\n  },\n  {"
    cards_raw = cards_str.split('\n  },\n  {\n')
    # fix up the first and last
    cards_raw[0] = cards_raw[0].replace('\n  {\n', '', 1)
    cards_raw[-1] = cards_raw[-1].replace('\n  }\n', '', 1)
    
    cards = []
    for c in cards_raw:
        c = c.strip()
        if not c.startswith('{'):
            c = '{\n' + c
        if not c.endswith('}'):
            c = c + '\n}'
        
        # find date
        date_match = re.search(r'date:\s*"([^"]+)"', c)
        date = date_match.group(1) if date_match else ''
        cards.append((date, c))
    
    # Sort cards descending by date
    cards.sort(key=lambda x: x[0], reverse=True)
    
    # Reassemble
    new_cards_str = '\n  ' + ',\n  '.join([c[1] for c in cards]) + '\n'
    new_content = content[:match.start(1)] + new_cards_str + content[match.end(1):]
    
    with open('client/src/components/HomeFeatureCarousel.tsx', 'w', encoding='utf-8') as f:
        f.write(new_content)
    print("Updated!")
else:
    print("Could not find CAROUSEL_CARDS")

