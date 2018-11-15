// Copyright IBM Corp. 2018. All Rights Reserved.
// Node module: @loopback/events
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

import {EventEmitter} from 'events';

export type EventEntry<T> = {
  name: string;
  data?: T;
};

export type AsyncEventIteratorOptions = {
  doneEventName?: string;
  errorEventName?: string;
  listenNow?: boolean;
};

export class AsyncEventIterator<T>
  implements AsyncIterableIterator<EventEntry<T>> {
  private readonly eventNames: string[];

  private readonly promiseQueue: {
    resolve: (value: unknown) => void;
    reject: (err: unknown) => void;
  }[] = [];
  private readonly eventQueue: EventEntry<T>[] = [];
  private listening = true;
  private listenersAdded = false;
  private readonly listeners: {[name: string]: ((event: T) => void)} = {};
  private doneListener?: (event: T) => void;
  private errorListener?: (event: T) => void;

  constructor(
    private readonly eventEmitter: EventEmitter,
    eventNames: string[],
    private readonly options: AsyncEventIteratorOptions = {
      doneEventName: 'done',
      errorEventName: 'error',
    },
  ) {
    this.eventNames = eventNames;
    if (options && options.listenNow) {
      this.addEventListeners();
      this.listenersAdded = true;
    }
  }

  /**
   * Add an event
   * @param event
   */
  private pushEvent(event: T, eventName: string) {
    const entry: EventEntry<T> = {data: event, name: eventName};
    if (this.promiseQueue.length !== 0) {
      const p = this.promiseQueue.shift()!;
      if (eventName === this.options.errorEventName) {
        p.reject(event);
      } else {
        p.resolve({
          value: entry,
          done: eventName === this.options.doneEventName,
        });
      }
    } else {
      this.eventQueue.push(entry);
    }
  }

  /**
   * Consume an event
   */
  private pullEvent() {
    return new Promise<IteratorResult<EventEntry<T>>>((resolve, reject) => {
      if (this.eventQueue.length !== 0) {
        const entry = this.eventQueue.shift()!;
        if (entry.name === this.options.errorEventName) {
          reject(entry.data);
        } else {
          // Resolve the promise with first event in the queue
          resolve({
            value: entry,
            done: entry.name === this.options.doneEventName,
          });
        }
      } else {
        // Defer resolve()
        this.promiseQueue.push({resolve, reject});
      }
    });
  }

  /**
   * Drain the queue
   */
  private drain() {
    if (this.listening) {
      this.listening = false;
      if (this.listenersAdded) {
        this.removeEventListeners();
      }
      this.promiseQueue.forEach(p => p.resolve({value: undefined, done: true}));
      this.promiseQueue.splice(0, this.promiseQueue.length);
      this.eventQueue.splice(0, this.eventQueue.length);
    }
  }

  private createListener(eventName: string) {
    return (event: T) => this.pushEvent(event, eventName);
  }

  private addEventListeners() {
    for (const eventName of this.eventNames) {
      const listener = this.createListener(eventName);
      this.eventEmitter.addListener(eventName, listener);
      this.listeners[eventName] = listener;
    }
    if (this.options.doneEventName) {
      this.doneListener = this.createListener(this.options.doneEventName);
      this.eventEmitter.addListener(
        this.options.doneEventName,
        this.doneListener,
      );
    }
    if (this.options.errorEventName) {
      this.errorListener = this.createListener(this.options.errorEventName);
      this.eventEmitter.addListener(
        this.options.errorEventName,
        this.errorListener,
      );
    }
  }

  private removeEventListeners() {
    for (const eventName in this.listeners) {
      this.eventEmitter.removeListener(eventName, this.listeners[eventName]);
      delete this.listeners[eventName];
    }
    if (this.doneListener) {
      this.eventEmitter.removeListener(
        this.options.doneEventName!,
        this.doneListener,
      );
      this.doneListener = undefined;
    }
    if (this.errorListener) {
      this.eventEmitter.removeListener(
        this.options.errorEventName!,
        this.errorListener,
      );
      this.errorListener = undefined;
    }
  }

  next() {
    if (!this.listening) {
      return this.return();
    }
    if (!this.listenersAdded) {
      this.addEventListeners();
      this.listenersAdded = true;
    }
    return this.pullEvent();
  }

  return() {
    this.drain();
    const result: IteratorResult<EventEntry<T>> = {
      value: {data: undefined, name: this.options.doneEventName || 'done'},
      done: true,
    };
    return Promise.resolve(result);
  }

  throw(error: unknown) {
    this.drain();
    return Promise.reject(error);
  }

  [Symbol.asyncIterator]() {
    return this;
  }
}
