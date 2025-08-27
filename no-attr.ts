import type { Plugin,PluginOption } from 'vite';

import { parse } from 'node-html-parser';

const needBasePathArr = ['src', 'data-src'];

/**
 * @returns
 */
function htmlPostBuildPlugin(base?: string): Plugin {
  return {
    name: 'html-post-build',
    enforce: 'post',
    apply: 'build',
    transformIndexHtml(html) {
      const root = parse(html);

      // 删除modulescript标签
      while (root.querySelector('script[type="module"]')) {
        const moduleScript = root.querySelector('script[type="module"]');
        moduleScript?.remove();
      }
      // 删除modulepreload标签
      const prereloadScript = root.querySelector('link[rel="modulepreload"]');
      prereloadScript && prereloadScript.remove();
      const nomoduleScripts = root.querySelectorAll('script[nomodule]');
      for (let i in nomoduleScripts) {
        // 删除nomodule属性
        nomoduleScripts[i].removeAttribute('nomodule');
        nomoduleScripts[i].removeAttribute('crossorigin');
        // 这里需要手动添加相对路径
        if (base) {
          needBasePathArr.forEach(attrName => {
            if (nomoduleScripts[i].hasAttribute(attrName)) {
              const value = nomoduleScripts[i].getAttribute(attrName);
              if (!value?.startsWith(base)) {
                const fatmarttedValue = base + value;
                nomoduleScripts[i].setAttribute(attrName, fatmarttedValue);
              }
            }
          });
        }
      }

      const crossoriginLinks = root.querySelectorAll('link[crossorigin]');
      for (let i in crossoriginLinks) {
        crossoriginLinks[i].removeAttribute('nomodule');
        crossoriginLinks[i].removeAttribute('crossorigin');
        if (base) {
          needBasePathArr.forEach(attrName => {
            if (crossoriginLinks[i].hasAttribute(attrName)) {
              const value = crossoriginLinks[i].getAttribute(attrName);
              if (!value?.startsWith(base)) {
                const fatmarttedValue = base + value;
                crossoriginLinks[i].setAttribute(attrName, fatmarttedValue);
              }
            }
          });
        }
      }

      return root.innerHTML;
    },
  };
}

export default htmlPostBuildPlugin;