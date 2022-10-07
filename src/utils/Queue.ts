type Resolver<T> = (data: T) => void;

type ItemTask<T> = {
    readonly resolver: Resolver<T>;
    readonly timeout?: NodeJS.Timeout;
};

export default class Queue<T> {
    private buffer: T[];
    private tasks: ItemTask<T>[];

    constructor() {
        this.buffer = [];
        this.tasks = [];
    }

    push(element: T) {
        const task: ItemTask<T> | undefined = this.tasks.shift();
        if (task) {
            task.resolver(element);
            if (task.timeout) {
                clearTimeout(task.timeout);
            }
        } else {
            this.buffer.push(element);
        }
    }

    peek(): T | undefined {
        if (this.buffer.length) {
            return this.buffer[0];
        } else {
            return undefined;
        }
    }

    async pop(timeoutDuration: number = -1): Promise<T> {
        const element: T | undefined = this.buffer.shift();
        if (element) {
            return element;
        } else {
            return new Promise<T>(
                (res: Resolver<T>, rej: (err: Error) => void) => {
                    let timeout: NodeJS.Timeout | undefined;
                    if (timeoutDuration > 0) {
                        timeout = setTimeout(() => {
                            rej(
                                new Error(
                                    `Timeout after ${timeoutDuration} milliseconds`
                                )
                            );
                        }, timeoutDuration);
                    }
                    const itemTask: ItemTask<T> = {
                        resolver: res,
                        timeout,
                    };
                    this.tasks.push(itemTask);
                }
            );
        }
    }

    tryPop(): T | undefined {
        return this.buffer.shift();
    }

    size(): number {
        return this.buffer.length;
    }
}
