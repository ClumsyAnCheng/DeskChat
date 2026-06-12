(function () {
  const DEFAULT_SETTINGS = {
    provider: "openai",
    providerName: "OpenAI",
    baseUrl: "https://api.openai.com/v1/chat/completions",
    apiKey: "",
    model: "gpt-5.5",
    enableTools: true,
    supportsVision: true,
    systemPrompt:
      "你是一个运行在用户电脑上的桌面 AI 助手。你可以分析用户上传的图片和截图，也可以在用户明确要求时调用工具执行命令、移动鼠标或点击。调用命令和鼠标工具前先简短说明意图。"
  };

  const DEFAULT_MEMORY_SETTINGS = {
    enabled: true,
    rememberAssistant: true,
    recallEnabled: true,
    recallLimit: 6,
    minMessageChars: 8,
    minChunkChars: 24
  };

  const TOOL_DEFINITIONS = [
    {
      type: "function",
      function: {
        name: "take_screenshot",
        description: "Capture the user's primary screen only when the user explicitly asks to inspect the screen.",
        parameters: { type: "object", properties: {}, additionalProperties: false }
      }
    },
    {
      type: "function",
      function: {
        name: "run_command",
        description: "Run a local shell command only when the user explicitly asks you to execute a command.",
        parameters: {
          type: "object",
          properties: {
            command: { type: "string", description: "The command to run." },
            timeout: { type: "number", description: "Timeout in milliseconds. Defaults to 30000." }
          },
          required: ["command"],
          additionalProperties: false
        }
      }
    },
    {
      type: "function",
      function: {
        name: "move_mouse",
        description: "Move the mouse cursor only when the user explicitly asks for mouse control.",
        parameters: {
          type: "object",
          properties: {
            x: { type: "number" },
            y: { type: "number" }
          },
          required: ["x", "y"],
          additionalProperties: false
        }
      }
    },
    {
      type: "function",
      function: {
        name: "click_mouse",
        description: "Click at screen coordinates only when the user explicitly asks for mouse control.",
        parameters: {
          type: "object",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            button: { type: "string", enum: ["left", "right"] }
          },
          required: ["x", "y"],
          additionalProperties: false
        }
      }
    }
  ];

  const TEXT_ONLY_CAPABILITY_PROMPT =
    "\n\n当前 API 配置不支持图片输入。不要尝试截图分析或要求发送 image_url；如果用户要求看屏幕，请告诉用户需要切换到支持视觉的模型或中转站。";

  const RESPONSE_FORMAT_PROMPT =
    "\n\n回答数学、代码、表格或长解释时，请使用清晰的 Markdown：小标题、短段落、项目列表、表格和必要的 LaTeX 公式块。不要把整段推理挤成一整块。";

  window.DeskchatConfig = {
    DEFAULT_SETTINGS,
    DEFAULT_MEMORY_SETTINGS,
    TOOL_DEFINITIONS,
    TEXT_ONLY_CAPABILITY_PROMPT,
    RESPONSE_FORMAT_PROMPT
  };
})();
