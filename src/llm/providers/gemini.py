from google import genai
from google.genai import types


class GeminiProvider:
    # gemini-3.1-pro-preview / gemini-2.5-pro are 0-quota on this project's free
    # tier (confirmed against the real API) -- default to a model this key can
    # actually call. Override with AGENT_LLM_MODEL for accounts with paid/pro
    # access, per spec/agent.md's Model table.
    DEFAULT_MODEL = "gemini-2.5-flash"

    def __init__(self, api_key: str, model: str) -> None:
        self._client = genai.Client(api_key=api_key)
        self._model = model or self.DEFAULT_MODEL

    def call_model(self, prompt: str, *, system: str | None = None, model: str | None = None) -> str:
        config = types.GenerateContentConfig(
            system_instruction=system,
        ) if system else None
        response = self._client.models.generate_content(
            model=model or self._model,
            contents=prompt,
            config=config,
        )
        return response.text
