import { registerDict } from "./index";
import { uiDict } from "./locales/ui";

// 在此集中注册所有域的翻译表。新增 locale 文件后在这里 registerDict。
registerDict(uiDict);
