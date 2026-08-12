var recalledMsgSet = new Set();
// The main process keeps the legacy API name, but this set intentionally
// contains every persisted group recall (text, image, or mixed).
var recalledGroupIds = new Set();

var nowConfig = {};

export async function onSettingWindowCreated(view) {
  nowConfig = await window.anti_recall.getNowConfig();

  const new_navbar_item = `
    <plugin-menu>
      <setting-item class="config_view">
        <setting-section data-title="主配置">
          <setting-panel>
            <setting-list data-direction="column">     
                <setting-item data-direction="row">
                  <setting-text>操作</setting-text>
                    <button id="clearDb" class="q-button q-button--small q-button--secondary">清空已储存的撤回消息</button>
                </setting-item>
                <setting-item data-direction="row">
                    <div style="width:90%;" >
                      <setting-text>是否将撤回消息存入数据库</setting-text>
                      <span class="secondary-text">数据库不加密，若开启风险自负；若不开启，重启QQ后撤回消息会丢失；开启选项后，反撤回消息才会开始保存；若之前开过，现在关闭，储存的消息不会被删除，需要你手动清理。</span>
                    </div>
                    <div id="switchSaveDb" class="q-switch">
                      <span class="q-switch__handle"></span>
                    </div>
                </setting-item>
                <div class="vertical-list-item">
                    <div style="width:90%;" >
                      <h2>是否反撤回自己的消息</h2>
                      <span class="secondary-text">如果开启，则自己发送的消息也会被反撤回。开启后，从下一条消息开始起生效。</span>
                    </div>
                    <div id="switchAntiRecallSelf" class="q-switch">
                      <span class="q-switch__handle"></span>
                    </div>
                </div>
                <setting-item data-direction="row">
                  <div>
                    <h2>内存中消息最多缓存条数</h2>
                    <span class="secondary-text">修改将自动保存并立即生效；如果过少可能导致消息接受太快时来不及反撤回，如果过多可能导致内存占用过高。</span>
                  </div>
                  <div style="width:30%;pointer-events: auto;margin-left:10px;">
                    <input id="maxMsgLimit" min="1" max="99999999" maxlength="8" class="text_color path-input" style="width:65%;" type="number" value="${
                  nowConfig.maxMsgSaveLimit == null
                    ? 10000
                    : nowConfig.maxMsgSaveLimit
                        }"/>条
                  </div>
                </setting-item>
    
                <setting-item data-direction="row">
                  <div>
                    <h2>清理内存缓存消息时一次性清理多少</h2>
                    <span class="secondary-text">修改将自动保存并立即生效；一次性清理过多可能导致某些消息反撤回失败，过少则可能导致内存增长过快。</span>
                  </div>
                  <div style="width:30%;pointer-events: auto;margin-left:10px;">
                    <input id="deletePerTime" min="1" max="99999" maxlength="5" class="text_color path-input" style="width:65%; margin-left: 3px" type="number" value="${
                  nowConfig.deleteMsgCountPerTime == null
                    ? 500
                    : nowConfig.deleteMsgCountPerTime
                        }"/>条
                  </div>
                </setting-item>
            </setting-list>

          </setting-panel>
        </setting-section>

        
        <setting-section data-title="样式配置">
          <setting-panel>

            <setting-list data-direction="column">

              <setting-item data-direction="row">
                <div>
                  <h2>撤回主题色</h2></h2>
                  <span class="secondary-text">将会同时影响阴影和“已撤回”提示的颜色</span>
                </div>
                <div>
                  <input type="color" value="#ff0000" class="q-button q-button--small q-button--secondary pick-color" />
                </div>
              </setting-item>

              <hr class="horizontal-dividing-line" />          

              <div class="vertical-list-item">
                <div>
                  <h2>撤回后消息是否显示阴影</h2>
                  <span class="secondary-text">修改将自动保存并实时生效</span>
                </div>
                <div id="switchShadow" class="q-switch">
                  <span class="q-switch__handle"></span>
                </div>
              </div>

              <hr class="horizontal-dividing-line" />          

              <div class="vertical-list-item">
                <div>
                  <h2>撤回后消息下方是否显示“已撤回”提示</h2>
                  <span class="secondary-text">修改将自动保存并在重新滚动消息后生效</span>
                </div>
                <div id="switchTip" class="q-switch">
                  <span class="q-switch__handle"></span>
                </div>
              </div>
              
            </setting-list>
          </setting-panel>
        </setting-section>


        <style>
          .img-hidden {
            display:none;
          }

          .path-input {
            align-self: normal;
            flex: 1;
            border-radius: 4px;
            margin-right: 16px;
            transition: all 100ms ease-out;
            border: 1px solid #464646;
          }
        
          .path-input:focus {
            padding-left: 4px;
          }
          
          .bq-icon {
            height:16px;
            width:16px;
          }
          
          /* 通用 */
          .config_view {
              margin: 20px;
          }
          
          .config_view h1 {
              color: var(--text_primary);
              font-weight: var(--font-bold);
              font-size: min(var(--font_size_3), 18px);
              line-height: min(var(--line_height_3), 24px);
              padding: 0px 16px;
              margin-bottom: 8px;
          }
          
          .config_view .wrap {
              /* Linux样式兼容：--fg_white */
              background-color: var(--fill_light_primary, var(--fg_white));
              border-radius: 8px;
              font-size: min(var(--font_size_3), 18px);
              line-height: min(var(--line_height_3), 24px);
              margin-bottom: 20px;
              overflow: hidden;
              padding: 0px 16px;
          }
          
          .config_view .vertical-list-item {
              margin: 12px 0px;
              display: flex;
              justify-content: space-between;
              align-items: center;
          }
          
          .config_view .horizontal-dividing-line {
              border: unset;
              margin: unset;
              height: 1px;
              background-color: rgba(127, 127, 127, 0.15);
          }
          
          .config_view .vertical-dividing-line {
              border: unset;
              margin: unset;
              width: 1px;
              background-color: rgba(127, 127, 127, 0.15);
          }
          
          .config_view .ops-btns {
              display: flex;
          }
          
          .config_view .hidden {
              display: none !important;
          }
          
          .config_view .disabled {
              pointer-events: none;
              opacity: 0.5;
          }
          
          .config_view .secondary-text {
              color: var(--text_secondary);
              font-size: min(var(--font_size_2), 16px);
              line-height: min(var(--line_height_2), 22px);
              margin-top: 4px;
          }
          
          .config_view .wrap .title {
              cursor: pointer;
              font-size: min(var(--font_size_3), 18px);
              line-height: min(var(--line_height_3), 24px);
          }
          
          .config_view .wrap .title svg {
              width: 1em;
              height: 1em;
              transform: rotate(-180deg);
              transition-duration: 0.2s;
              transition-timing-function: ease;
              transition-delay: 0s;
              transition-property: transform;
          }
          
          .config_view .wrap .title svg.is-fold {
              transform: rotate(0deg);
          }
          
          
          /* 模态框 */
          .config_view .modal-window {
              display: flex;
              justify-content: center;
              align-items: center;
              position: fixed;
              top: 0;
              right: 0;
              bottom: 0;
              left: 0;
              z-index: 999;
              background-color: rgba(0, 0, 0, 0.5);
          }
          
          .config_view .modal-dialog {
              width: 480px;
              border-radius: 8px;
              /* Linux样式兼容：--fg_white */
              background-color: var(--bg_bottom_standard, var(--fg_white));
          }
          
          .config_view .modal-dialog header {
              font-size: 12px;
              height: 30px;
              line-height: 30px;
              text-align: center;
          }
          
          .config_view .modal-dialog main {
              padding: 0px 16px;
          }
          
          .config_view .modal-dialog main p {
              margin: 8px 0px;
          }
          
          .config_view .modal-dialog footer {
              height: 30px;
              display: flex;
              justify-content: right;
              align-items: center;
          }
          
          .config_view .modal-dialog .q-icon {
              width: 22px;
              height: 22px;
              margin: 8px;
          }
          
          
          /* 版本号 */
          .config_view .versions .wrap {
              display: flex;
              justify-content: space-between;
              padding: 16px 0px;
          }
          
          .config_view .versions .wrap>div {
              flex: 1;
              margin: 0px 10px;
              border-radius: 8px;
              text-align: center;
          }
          
          
          /* 数据目录 */
          .config_view .path .path-input {
              align-self: normal;
              flex: 1;
              border-radius: 4px;
              margin-right: 16px;
              transition: all 100ms ease-out;
          }
          
          .config_view .path .path-input:focus {
              padding-left: 5px;
              background-color: rgba(127, 127, 127, 0.1);
          }
          
          /* 选择框容器 */
          .config_view .list-ctl .ops-selects {
              display: flex;
              gap: 8px;
          }
          

          @media (prefers-color-scheme: light) {
              .text_color {
                  color: black;
              }
          }
          
          @media (prefers-color-scheme: dark) {
              .text_color {
                  color: white;
              }
          }

        </style>
      </div>
    </plugin-menu>
  `;

  const parser = new DOMParser();

  const doc2 = parser.parseFromString(new_navbar_item, "text/html");
  const node2 = doc2.querySelector("plugin-menu");//这里寻找插入的对象

  //清空消息
  node2.querySelector("#clearDb").onclick = async () => {
    await window.anti_recall.clearDb();
  };

  node2.querySelector("#maxMsgLimit").onblur = async () => {
    var limit = parseFloat(node2.querySelector("#maxMsgLimit").value);
    if (limit <= 0 || limit > 99999999) {
      alert("你的数量输入有误！将不会保存，请重新输入");
      return;
    }
    nowConfig.maxMsgSaveLimit = limit;
    await window.anti_recall.saveConfig(nowConfig);
  };

  node2.querySelector("#deletePerTime").onblur = async () => {
    var limit = parseFloat(node2.querySelector("#deletePerTime").value);
    if (limit <= 0 || limit > 99999) {
      alert("你的数量输入有误！将不会保存，请重新输入");
      return;
    }
    nowConfig.deleteMsgCountPerTime = limit;
    await window.anti_recall.saveConfig(nowConfig);
  };

  //选择颜色
  const pickColor = node2.querySelector(".pick-color");
  pickColor.value = nowConfig.mainColor;
  pickColor.addEventListener("change", async (event) => {
    nowConfig.mainColor = event.target.value;
    await window.anti_recall.saveConfig(nowConfig);
  });

  //存数据库开关
  var q_switch_savedb = node2.querySelector("#switchSaveDb");

  if (nowConfig.saveDb == null || nowConfig.saveDb == true) {
    q_switch_savedb.classList.toggle("is-active");
  }

  q_switch_savedb.addEventListener("click", async () => {
    if (q_switch_savedb.classList.contains("is-active")) {
      nowConfig.saveDb = false;
    } else {
      nowConfig.saveDb = true;
    }
    q_switch_savedb.classList.toggle("is-active");
    await window.anti_recall.saveConfig(nowConfig);
  });

  //反撤回自己消息开关
  var q_switch_antiself = node2.querySelector("#switchAntiRecallSelf");

  if (nowConfig.isAntiRecallSelfMsg == true) {
    q_switch_antiself.classList.toggle("is-active");
  }

  q_switch_antiself.addEventListener("click", async () => {
    if (q_switch_antiself.classList.contains("is-active")) {
      nowConfig.isAntiRecallSelfMsg = false;
    } else {
      nowConfig.isAntiRecallSelfMsg = true;
    }
    q_switch_antiself.classList.toggle("is-active");
    await window.anti_recall.saveConfig(nowConfig);
  });

  //阴影开关
  var q_switch_shadow = node2.querySelector("#switchShadow");

  if (nowConfig.enableShadow == null || nowConfig.enableShadow == true) {
    q_switch_shadow.classList.toggle("is-active");
  }

  q_switch_shadow.addEventListener("click", async () => {
    if (q_switch_shadow.classList.contains("is-active")) {
      nowConfig.enableShadow = false;
    } else {
      nowConfig.enableShadow = true;
    }
    q_switch_shadow.classList.toggle("is-active");
    await window.anti_recall.saveConfig(nowConfig);
  });

  //提示开关
  var q_switch_tip = node2.querySelector("#switchTip");

  if (nowConfig.enableTip == null || nowConfig.enableTip == true) {
    q_switch_tip.classList.toggle("is-active");
  }

  q_switch_tip.addEventListener("click", async () => {
    if (q_switch_tip.classList.contains("is-active")) {
      //取消
      nowConfig.enableTip = false;
    } else {
      //重新设置
      nowConfig.enableTip = true;
    }
    q_switch_tip.classList.toggle("is-active");
    await window.anti_recall.saveConfig(nowConfig);
  });

  view.appendChild(node2);
}

async function patchCss() {
  nowConfig = await window.anti_recall.getNowConfig();

  var cssNode = document
    .evaluate("/html/head/style[@id='anti-recall-css']", document)
    .iterateNext();
  if (cssNode) {
    cssNode.parentElement.removeChild(cssNode);
  }
  var stylee = document.createElement("style");
  stylee.type = "text/css";
  stylee.id = "anti-recall-css";

  var sHtml = `   .message-content__wrapper {
                    color: var(--bubble_guest_text);
                    display: flex;
                    grid-row-start: content;
                    grid-column-start: content;
                    grid-row-end: content;
                    grid-column-end: content;
                    max-width: -webkit-fill-available;
                    min-height: 38px;
                    overflow: visible !important;
                    border-radius: 10px; 
                  }

                  .message-content__wrapper.message-content-recalled-parent {
                    padding: 0px !important;
                  }

                  .message-content-recalled-parent {
                    border-radius: 10px;
                    position: relative;
                    overflow: unset !important;`;
  if (nowConfig.enableShadow == true) {
    sHtml += `      margin-top:3px;
                    margin-left:3px;
                    margin-right:3px;
                    margin-bottom: 25px;
                    box-shadow: 0px 0px 8px 5px ${nowConfig.mainColor} !important;`;
  } else {
    sHtml += `margin-bottom: 15px;`;
  }
  sHtml += `                }
            .recalledNoMargin {
                margin-top: 0px!important;
            }

            .message-content-recalled {
                position: absolute;
                top: calc(100% + 6px);
                left: 0;
                font-size: 12px;
                white-space: nowrap;
                color: var(--text-color);
                background-color: var(--background-color-05);
                backdrop-filter: blur(28px);
                padding: 4px 8px;
                margin-bottom: 2px;
                border-radius: 6px;
                box-shadow: var(--box-shadow);
                transition: 300ms;
                transform: translateX(-30%);
                opacity: 0;
                pointer-events: none;
                color:${nowConfig.mainColor};
            }

            .anti-recall-group-image-fallback {
                display: block;
                max-width: 100%;
                max-height: 520px;
                object-fit: contain;
                border-radius: 8px;
            }

            .anti-recall-group-message-fallback {
                display: flex;
                align-items: flex-start;
                gap: 10px;
                margin: 8px 0 28px 40px;
                max-width: min(70%, 720px);
            }

            .anti-recall-group-message-fallback--native-avatar {
                margin-left: 86px;
            }

            .anti-recall-group-avatar-fallback {
                width: 36px;
                height: 36px;
                flex: 0 0 36px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                color: #fff;
                background: ${nowConfig.mainColor};
                font-size: 15px;
                font-weight: 600;
                object-fit: cover;
            }

            .anti-recall-group-message-column {
                min-width: 0;
            }

            .anti-recall-group-sender-fallback {
                margin: 0 0 5px 3px;
                color: var(--text-secondary, #999);
                font-size: 13px;
            }

            .anti-recall-group-bubble-fallback {
                display: flex;
                flex-direction: column;
                gap: 7px;
                width: fit-content;
                max-width: 100%;
                padding: 0;
                border-radius: 8px;
                position: relative;
                overflow: visible !important;
                box-shadow: 0 0 8px 5px ${nowConfig.mainColor} !important;
            }

            .anti-recall-group-text-fallback {
                padding: 9px 12px;
                border-radius: 8px;
                background: var(--bubble_guest_bg, #fff);
                color: var(--bubble_guest_text, #000);
                white-space: pre-wrap;
                overflow-wrap: anywhere;
            }
        `;
  stylee.innerHTML = sHtml;
  document.getElementsByTagName("head").item(0).appendChild(stylee);
}

onLoad();

async function onLoad() {
  try {
    const [persistedIds, persistedImageIds] = await Promise.all([
      anti_recall.getRecalledMsgIds(),
      anti_recall.getRecalledGroupImageIds(),
    ]);
    if (Array.isArray(persistedIds)) {
      recalledMsgSet = new Set(persistedIds.map(String));
    }
    if (Array.isArray(persistedImageIds)) {
      recalledGroupIds = new Set(persistedImageIds.map(String));
    }
  } catch (error) {
    console.log("[Anti-Recall]", "读取已保存的撤回索引失败", error);
  }

  anti_recall.repatchCss(async (event, _) => {
    await patchCss();
  });

  //消息更新回调
  anti_recall.recallTip(async (event, msgId, hasGroupFallback) => {
    console.log("[Anti-Recall]", "尝试反撤回消息ID", msgId);
    recalledMsgSet.add(String(msgId));
    if (hasGroupFallback === true) recalledGroupIds.add(String(msgId));

    var oldElement = document.getElementById(`${msgId}-msgContainerMsgContent`);

    var newElement = document.getElementById(`${msgId}-msgContent`);

    var unixElement = document
      .getElementById(`ml-${msgId}`)
      ?.querySelector(".msg-content-container");

    var cardElement = document.getElementById(`${msgId}-msgContent`);

    var arkElement = document.getElementById(
      `ark-msg-content-container_${msgId}`
    );

    if (oldElement != null && !oldElement.classList.contains("gray-tip-message")) {
      await appendRecalledTag(oldElement);
    } else if (newElement != null && !newElement.classList.contains("gray-tip-message")) {
      await appendRecalledTag(newElement.parentElement);
    } else if (unixElement != null && !unixElement.classList.contains("gray-tip-message")) {
      await appendRecalledTag(unixElement.parentElement);
    } else if (cardElement != null && !cardElement.classList.contains("gray-tip-message")) {
      cardElement.classList.add("recalledNoMargin");
      await appendRecalledTag(cardElement.parentElement);
    } else if (arkElement != null && !arkElement.classList.contains("gray-tip-message")) {
      arkElement.classList.add("recalledNoMargin");
      await appendRecalledTag(arkElement.parentElement);
    } else{
      var container = document.querySelector(`.ml-item[id='${msgId}'] .msg-content-container`);
      if (container) await appendRecalledTag(container);
    }
    await ensureGroupRecallFallback(document.getElementById(String(msgId)), msgId);
  });
  //消息列表更新回调
  anti_recall.recallTipList(async (event, msgIdList) => {
    if (Array.isArray(msgIdList)) {
      for (var recalledId of msgIdList) recalledMsgSet.add(String(recalledId));
    }
    await render();
  });
  anti_recall.recalledImageReady(async (event, msgId) => {
    var messageElement = document.getElementById(String(msgId));
    if (!messageElement) return;
    messageElement.querySelector(".anti-recall-group-message-fallback")?.remove();
    messageElement.querySelectorAll("[data-anti-recall-native-hidden]").forEach((element) => {
      element.style.display = "";
      delete element.dataset.antiRecallNativeHidden;
    });
    delete messageElement.dataset.antiRecallImageFallback;
    await ensureGroupRecallFallback(messageElement, msgId);
  });

  await patchCss();

  var renderScheduled = false;
  var renderRunning = false;
  var renderDirty = false;
  function scheduleRender() {
    renderDirty = true;
    if (renderScheduled || renderRunning) return;
    renderScheduled = true;
    setTimeout(async () => {
      renderScheduled = false;
      renderRunning = true;
      renderDirty = false;
      try {
        await render();
      } finally {
        renderRunning = false;
        if (renderDirty) scheduleRender();
      }
    }, 50);
  }
  //监控消息列表，如果有撤回则渲染
  const observer = new MutationObserver((mutationsList) => {
    for (let mutation of mutationsList) {
      if (mutation.type === "childList") {
        var addedNodes = Array.from(mutation.addedNodes || []);
        if (addedNodes.length > 0 && addedNodes.every((node) =>
          node.classList?.contains("message-content-recalled"))) continue;
        scheduleRender();
      }
    }
  });

  var finder = setInterval(() => {
    if (document.querySelector(".ml-list.list")) {
      clearInterval(finder);
      console.log("[Anti-Recall]", "检测到聊天区域，已在当前页面加载反撤回");
      const targetNode = document.querySelector(".ml-list.list");
      const config = {
        attributes: false,
        childList: true,
        subtree: true,
      };
      observer.observe(targetNode, config);
    }
  }, 100);

  async function render() {
    var elements = document
      .querySelector(".chat-msg-area__vlist")
      ?.querySelectorAll(".ml-item");

    for (var el of elements || []) {
      if (recalledMsgSet.has(String(el.id))) {
        var msgId = String(el.id);
        try {
          var oldElement = el.querySelector(
            `div[id='${msgId}-msgContainerMsgContent']`
          );

          var newElement = el.querySelector(`div[id='${msgId}-msgContent']`);

          var unixElement = el
            .querySelector(`div[id='ml-${msgId}']`)
            ?.querySelector(".msg-content-container");

          var cardElement = el.querySelector(`div[id='${msgId}-msgContent']`);

          var arkElement = el.querySelector(
            `div[id='ark-msg-content-container_${msgId}']`
          );

          if (oldElement != null && !oldElement.classList.contains("gray-tip-message")) {
            await appendRecalledTag(oldElement);
          } else if (newElement != null && !newElement.classList.contains("gray-tip-message")) {
            await appendRecalledTag(newElement.parentElement);
          } else if (unixElement != null && !unixElement.classList.contains("gray-tip-message")) {
            await appendRecalledTag(unixElement.parentElement);
          } else if (cardElement != null && !cardElement.classList.contains("gray-tip-message")) {
            cardElement.classList.add("recalledNoMargin");
            await appendRecalledTag(cardElement.parentElement);
          } else if (arkElement != null && !arkElement.classList.contains("gray-tip-message")) {
            arkElement.classList.add("recalledNoMargin");
            await appendRecalledTag(arkElement.parentElement);
          }
          else{
	          var container = el.querySelector('.msg-content-container');
		  if (!container) container = el.querySelector('.file-message--content');
	          if (container) await appendRecalledTag(container);
          }
          await ensureGroupRecallFallback(el, msgId);
        } catch (e) {
          console.log("[Anti-Recall]", "反撤回消息时出错", e);
        }
      }
    }
  }

  async function appendRecalledTag(msgElement) {
    if (!msgElement) return;

    var currRecalledTip = msgElement.querySelector(".message-content-recalled");
    if (currRecalledTip == null) {
      msgElement.classList.add("message-content-recalled-parent");

      if (nowConfig.enableTip == true) {
        const recalledEl = document.createElement("div");
        recalledEl.innerText = "已撤回";
        recalledEl.classList.add("message-content-recalled");

        msgElement.appendChild(recalledEl);
        setTimeout(() => {
          recalledEl.style.transform = "translateX(0)";
          recalledEl.style.opacity = "1";
        }, 5);
      }
    } else {
      //已经有撤回标记了，不再重复添加
    }
  }

  async function ensureGroupRecallFallback(messageElement, msgId) {
    if (!messageElement || !recalledGroupIds.has(String(msgId)) || messageElement.dataset.antiRecallImageFallback) return;
    messageElement.dataset.antiRecallImageFallback = "loading";
    var payloads;
    try {
      payloads = await window.anti_recall.getRecalledGroupImages(msgId);
    } catch (error) {
      delete messageElement.dataset.antiRecallImageFallback;
      console.log("[Anti-Recall]", "读取已保存的群撤回图片失败", error);
      return;
    }
    if (!Array.isArray(payloads) || payloads.length === 0) {
      delete messageElement.dataset.antiRecallImageFallback;
      return;
    }

    var nativeContentRoot = messageElement.querySelector(".msg-content-container")
      || messageElement.querySelector(".message-content__wrapper")
      || messageElement.querySelector("[id$='-msgContent']");
    var nativeImages = Array.from(nativeContentRoot?.querySelectorAll("img") || [])
      .filter((img) => !img.classList.contains("anti-recall-group-image-fallback"));
    var nativeImageReady = nativeImages.some((img) => img.complete && img.naturalWidth > 1);
    var expectsImage = payloads.some((payload) => Boolean(payload?.hasImage));
    var nativeText = String(nativeContentRoot?.innerText || "").trim();
    var nativeIsRecallTip = !nativeContentRoot
      || nativeContentRoot.classList.contains("gray-tip-message")
      || Boolean(nativeContentRoot.querySelector(".gray-tip-message"))
      || /撤回了.{0,8}(消息|信息)/.test(nativeText);
    // Prefer QQ's native bubble whenever it is complete. The custom card is a
    // replacement only for missing image bytes or a text message reduced to a
    // gray recall tip.
    if ((expectsImage && nativeImageReady) || (!expectsImage && nativeText && !nativeIsRecallTip)) {
      messageElement.dataset.antiRecallImageFallback = "native";
      return;
    }

    messageElement.querySelectorAll(".gray-tip-message").forEach((element) => {
      element.style.display = "none";
      element.dataset.antiRecallNativeHidden = "1";
    });
    if (nativeContentRoot && nativeContentRoot.style.display !== "none") {
      nativeContentRoot.style.display = "none";
      nativeContentRoot.dataset.antiRecallNativeHidden = "1";
    }
    var fallback = document.createElement("div");
    fallback.className = "anti-recall-group-message-fallback";
    var nativeAvatar = findGroupAvatarElement(messageElement);
    var nativeSender = findGroupSenderElement(messageElement, payloads[0]?.senderName);
    var avatar = null;
    if (nativeAvatar) {
      fallback.classList.add("anti-recall-group-message-fallback--native-avatar");
    } else {
      var avatarSource = String(payloads[0]?.avatarUrl || "");
      avatar = document.createElement(avatarSource ? "img" : "div");
      avatar.className = "anti-recall-group-avatar-fallback";
      if (avatarSource) {
        avatar.src = avatarSource;
        avatar.alt = payloads[0]?.senderName || "群成员";
        avatar.addEventListener("error", () => {
          var replacement = document.createElement("div");
          replacement.className = avatar.className;
          replacement.innerText = String(payloads[0]?.senderName || "群").trim().slice(0, 1) || "群";
          avatar.replaceWith(replacement);
        }, { once: true });
      } else {
        avatar.innerText = String(payloads[0]?.senderName || "群").trim().slice(0, 1) || "群";
      }
    }
    var column = document.createElement("div");
    column.className = "anti-recall-group-message-column";
    var sender = document.createElement("div");
    sender.className = "anti-recall-group-sender-fallback";
    sender.innerText = payloads[0]?.senderName || "群成员";
    var bubble = document.createElement("div");
    bubble.className = "anti-recall-group-bubble-fallback message-content-recalled-parent";
    for (var payload of payloads) {
      if (!payload?.fileUrl) continue;
      var image = document.createElement("img");
      image.className = "anti-recall-group-image-fallback";
      image.src = payload.fileUrl;
      image.alt = payload.fileName || "已撤回图片";
      if (payload.width > 0) image.width = payload.width;
      if (payload.height > 0) image.height = payload.height;
      bubble.appendChild(image);
    }
    if (payloads[0]?.text) {
      var text = document.createElement("div");
      text.className = "anti-recall-group-text-fallback";
      text.innerText = payloads[0].text;
      bubble.appendChild(text);
    }
    if (!bubble.childElementCount) {
      var unavailable = document.createElement("div");
      unavailable.className = "anti-recall-group-text-fallback";
      unavailable.innerText = "撤回图片的本地副本已不存在";
      bubble.appendChild(unavailable);
    }
    if (!nativeSender) column.appendChild(sender);
    column.appendChild(bubble);
    if (avatar) fallback.appendChild(avatar);
    fallback.appendChild(column);
    messageElement.appendChild(fallback);
    await appendRecalledTag(bubble);
    messageElement.dataset.antiRecallImageFallback = "ready";
    for (var nativeImage of nativeImages) {
      nativeImage.addEventListener("load", () => {
        if (!nativeImages.some((img) => img.complete && img.naturalWidth > 1)) return;
        fallback.remove();
        messageElement.querySelectorAll("[data-anti-recall-native-hidden]").forEach((element) => {
          element.style.display = "";
          delete element.dataset.antiRecallNativeHidden;
        });
        messageElement.dataset.antiRecallImageFallback = "native";
      }, { once: true });
    }
  }

  function findGroupAvatarElement(messageElement) {
    if (!messageElement) return null;
    for (var image of Array.from(messageElement.querySelectorAll("img"))) {
      if (image.classList.contains("anti-recall-group-image-fallback")) continue;
      if (image.closest(".msg-content-container, .message-content__wrapper, [id$='-msgContent']")) continue;
      return image;
    }
    return null;
  }

  function findGroupSenderElement(messageElement, senderName) {
    var wanted = String(senderName || "").trim();
    if (!messageElement || !wanted) return null;
    for (var element of Array.from(messageElement.querySelectorAll("span, div"))) {
      if (element.closest(".msg-content-container, .message-content__wrapper, [id$='-msgContent']")) continue;
      if (element.children.length > 0) continue;
      if (String(element.textContent || "").trim() === wanted) return element;
    }
    return null;
  }
}
