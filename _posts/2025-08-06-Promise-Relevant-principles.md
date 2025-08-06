---
title: Promise 原理解析
date: 2025-08-06 11:05 +0800
categories: [Blogging, JavaScript]
tags: [javascript, promise]     # TAG names should always be lowercase
render_with_liquid: false
author: pigknightx
---

# Promise 原理解析
以下是对 JavaScript 中 **Promise 实现原理** 的深入讲解，面向具有 5-10 年经验的前端工程师，涵盖从设计思想到规范实现的各个核心方面。

---

## 一、Promise 的核心设计思想与解决的问题

### 1.1 背景：异步编程的痛点

在 ES6 之前，JavaScript 使用 **回调函数（Callback）** 来处理异步任务，如下所示：

```js
readFile('data.json', (err, data) => {
  if (err) return handleError(err);
  parseJSON(data, (err, result) => {
    if (err) return handleError(err);
    processData(result);
  });
});
```

这导致了：

* 回调地狱（Callback Hell）
* 错误传递不一致
  * 错误处理靠人为规范（Node-style callback）
  * 一旦开发者遗漏 err 参数，或内部函数抛出异常未被捕获，整个系统就可能崩溃
  * 难以链式传播错误
  * 缺乏统一的异常通道（Exception Channel）
  * Promise 统一封装到 .catch() 中处理。 一旦链条中某个 .then() 抛出异常，后续 .catch() 会自动捕获，简化了流程控制
* 控制流难以预测

### 1.2 Promise 的设计思想

> **Promise 是一个对未来值的占位符。**

Promise 的核心目标是：

* 提供可组合的异步控制流
* 使异步代码看起来更像同步代码
* 明确状态生命周期（pending → fulfilled/rejected）

### 1.3 三个状态

Promise 存在三种状态，状态一旦改变不可逆：

| 状态        | 描述     |
| --------- | ------ |
| pending   | 初始状态   |
| fulfilled | 操作成功完成 |
| rejected  | 操作失败   |

---

## 二、设计模式在 Promise 中的应用

### 2.1 状态模式（State Pattern）

**应用位置：** Promise 内部状态管理

* 每个 Promise 实例维护一个当前状态：`pending` → `fulfilled/rejected`
* 状态转移后行为固定，不可再改变

```js
// 简化版状态切换
function resolve(value) {
  if (this.status !== 'pending') return;
  this.status = 'fulfilled';
  this.value = value;
}
```

### 2.2 观察者模式（Observer Pattern）

**应用位置：** `.then()` 注册回调、异步触发

* 订阅：通过 `.then()` 注册回调
* 通知：`resolve/reject` 时，异步执行已注册回调

```js
this.onFulfilledCallbacks.push(() => onFulfilled(this.value));
```

---

## 三、事件循环机制与 Promise 的关系

### 3.1 宏任务 vs 微任务

事件循环中，任务分为：

* **宏任务（macro task）：** `setTimeout`、`setInterval`、I/O
* **微任务（micro task）：** `Promise.then`、`MutationObserver`、`queueMicrotask`

### 3.2 Promise 回调进入微任务队列

```js
console.log('start');

Promise.resolve().then(() => console.log('microtask'));

setTimeout(() => console.log('macrotask'), 0);

console.log('end');
```

输出顺序：

```
start
end
microtask
macrotask
```

说明：

* `.then()` 中的回调被加入微任务队列
* 微任务优先于下一个宏任务执行

---

## 四、then/catch 的内部实现机制

### 4.1 then 的核心结构

```js
then(onFulfilled, onRejected) {
  return new Promise((resolve, reject) => {
    if (this.status === 'fulfilled') {
      queueMicrotask(() => {
        try {
          const result = onFulfilled(this.value);
          resolve(result);
        } catch (err) {
          reject(err);
        }
      });
    }
    // ... handle pending and rejected similarly
  });
}
```

### 4.2 链式调用的原理

* 每次 `.then()` 都返回一个新的 Promise
* 依赖返回值是否为 Promise 进行处理（Promise Resolution Procedure）

```js
if (result instanceof Promise) {
  result.then(resolve, reject);
} else {
  resolve(result);
}
```

### 4.3 错误捕获机制

`.catch()` 实际是 `.then(null, onRejected)` 的语法糖，支持链式错误处理。

---

## 五、常见 Promise API 的底层实现逻辑

### 5.1 Promise.resolve / reject

```js
Promise.resolve = function (value) {
  return new Promise((resolve) => resolve(value));
};
```

### 5.2 Promise.all

```js
Promise.all = function (iterable) {
  return new Promise((resolve, reject) => {
    const results = [];
    let completed = 0;

    iterable.forEach((p, i) => {
      Promise.resolve(p).then(value => {
        results[i] = value;
        if (++completed === iterable.length) {
          resolve(results);
        }
      }, reject); // 一旦有失败就 reject
    });
  });
};
```

### 5.3 Promise.race

```js
Promise.race = function (iterable) {
  return new Promise((resolve, reject) => {
    iterable.forEach(p => {
      Promise.resolve(p).then(resolve, reject);
    });
  });
};
```

---

## 六、与 Callback 模式的对比优势

| 特性      | Callback   | Promise                        |
| ------- | ---------- | ------------------------------ |
| 状态管理    | 不清晰        | 明确（pending/fulfilled/rejected） |
| 错误传播    | 必须手动传递 err | 自动向下传递                         |
| 控制流组合   | 困难，回调嵌套    | `.then().then()` 链式调用          |
| 可读性/维护性 | 差          | 好                              |
| 支持并发    | 较复杂        | `.all/.race` 等组合API 简洁高效       |

---

## 七、关键实现代码（完整示意）

```js
class MyPromise {
  constructor(executor) {
    this.status = 'pending';
    this.value = undefined;
    this.reason = undefined;
    this.onFulfilledCallbacks = [];
    this.onRejectedCallbacks = [];

    const resolve = value => {
      if (this.status === 'pending') {
        this.status = 'fulfilled';
        this.value = value;
        this.onFulfilledCallbacks.forEach(fn => fn());
      }
    };

    const reject = reason => {
      if (this.status === 'pending') {
        this.status = 'rejected';
        this.reason = reason;
        this.onRejectedCallbacks.forEach(fn => fn());
      }
    };

    try {
      executor(resolve, reject);
    } catch (err) {
      reject(err);
    }
  }

  then(onFulfilled, onRejected) {
    return new MyPromise((resolve, reject) => {
      if (this.status === 'fulfilled') {
        queueMicrotask(() => {
          try {
            const x = onFulfilled(this.value);
            resolve(x);
          } catch (e) {
            reject(e);
          }
        });
      } else if (this.status === 'rejected') {
        queueMicrotask(() => {
          try {
            const x = onRejected(this.reason);
            reject(x);
          } catch (e) {
            reject(e);
          }
        });
      } else {
        this.onFulfilledCallbacks.push(() => {
          queueMicrotask(() => {
            try {
              const x = onFulfilled(this.value);
              resolve(x);
            } catch (e) {
              reject(e);
            }
          });
        });

        this.onRejectedCallbacks.push(() => {
          queueMicrotask(() => {
            try {
              const x = onRejected(this.reason);
              reject(x);
            } catch (e) {
              reject(e);
            }
          });
        });
      }
    });
  }

  catch(onRejected) {
    return this.then(null, onRejected);
  }
}
```


