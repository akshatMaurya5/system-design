# Text-based search engine

## Table of Contents
- [Overview](#overview)
- [Naive search](#naive-search)
- [Core idea: indexing](#core-idea-indexing)
- [Relevance techniques](#relevance-techniques)
  - [Weighted scoring](#weighted-scoring)
  - [Fuzzy search](#fuzzy-search)
  - [Spell correction](#spell-correction)
  - [Synonyms](#synonyms)
  - [Phonetic matching](#phonetic-matching)
  - [Query segmentation](#query-segmentation)

## Overview

Information need: find the most `relevant` documents from a corpus.
- Corpus examples: JSON, web pages, text.

## Naive search

Simplest query flow:

- Query "q".
- Scan documents one by one.
- Check if the document matches.

This is O(n) and not scalable, especially with substring checks.

## Core idea: indexing

To make search efficient, use an index.

The core idea and crux is an inverted index on the corpus.

![alt text](image-11.png)

When we put any document into Elasticsearch, it is typically a JSON document with multiple fields such as `title`, `body`, `tags`, etc.

## Relevance techniques

### Weighted scoring

Different fields receive different weights.

Example:

- Query: `sachin tendulkar`
- A document with the phrase in `title` is more relevant than one with the phrase only in `body`.

### Fuzzy search

Use structures like BK-trees to handle typos.

- Search engine queries documents within one edit distance of the query.
- Example: for `lat`, candidates include `bat`, `cat`.
- For `bat`, candidates include `cat`, `mat`, `hat`, `rat`, etc.
- Give higher relevance to documents with minimum edit distance.

### Spell correction

This is product-specific.

- If the user misspells a known dictionary word, use it directly.
- If not, find the closest valid word and search it.
- Example: `HOUPE` -> `HOUSE`.
- This is similar to Google’s "Did you mean...?" suggestion.

### Synonyms

Match documents containing either of equivalent terms.

- Example: `HOME = HOUSE`.
- Product example: `bhindi = ladyfinger`.
- Search should return results for either synonym.

### Phonetic matching

Use algorithms like Metaphone or Soundex.

- Convert words to a root sound representation.
- Store and match based on sound.
- Useful when users remember sound but not spelling.

Example:

- `vedio` -> `vdo`
- `video` -> `vdo`

Both sound similar, so phonetic matching can help unify the query.

### Query segmentation

Handle cases where users forget spaces.

- Example: `mcdonals` -> `mc donalds`.




