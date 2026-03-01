# Vercel ESM Import Audit

## gemini-image imports
6: * Admin users bypass credits; paid users deduct from their balance.
8:import { GoogleGenAI } from "@google/genai";
9:import { storagePut } from "./storage";
123:  // Extract generated image from response

## storage references
9:import { storagePut } from "./storage";
142:  const { url } = await storagePut(fileKey, imageBuffer, mimeType);
