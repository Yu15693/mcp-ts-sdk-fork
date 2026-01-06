import type { Transport } from '../shared/transport.js';
import type { AuthInfo, JSONRPCMessage, RequestId } from '../types/types.js';

interface QueuedMessage {
    message: JSONRPCMessage;
    extra?: { authInfo?: AuthInfo };
}

/**
 * In-memory transport for creating clients and servers that talk to each other within the same process.
 * 内存传输层实现，用于在同一进程内创建相互通信的客户端和服务器。
 *
 * 主要用途：
 * 1. 单元测试和集成测试，无需真实网络开销。
 * 2. 在同一应用内解耦 Client 和 Server 模块。
 * 3. 演示和示例代码。
 */
export class InMemoryTransport implements Transport {
    /**
     * The other transport instance that this one is connected to.
     * 连接的另一端 Transport 实例。
     * 当调用 send() 时，会直接调用此实例的 onmessage 回调。
     */
    private _otherTransport?: InMemoryTransport;

    /**
     * Queue for messages sent before the connection is fully established (started).
     * 消息队列，用于暂存 start() 调用之前收到的消息。
     */
    private _messageQueue: QueuedMessage[] = [];

    onclose?: () => void;
    onerror?: (error: Error) => void;
    onmessage?: (message: JSONRPCMessage, extra?: { authInfo?: AuthInfo }) => void;
    sessionId?: string;

    /**
     * Creates a pair of linked in-memory transports that can communicate with each other. One should be passed to a Client and one to a Server.
     * 创建一对已连接的内存 Transport 实例。
     *
     * @returns [clientTransport, serverTransport] - 返回两个相互引用的 Transport 实例。
     * 通常一个传给 Client，另一个传给 Server。
     */
    static createLinkedPair(): [InMemoryTransport, InMemoryTransport] {
        const clientTransport = new InMemoryTransport();
        const serverTransport = new InMemoryTransport();
        clientTransport._otherTransport = serverTransport;
        serverTransport._otherTransport = clientTransport;
        return [clientTransport, serverTransport];
    }

    /**
     * Starts processing messages on the transport.
     * 启动 Transport。
     *
     * 核心逻辑：
     * 处理在 start() 调用之前就已经到达并存储在 _messageQueue 中的消息。
     */
    async start(): Promise<void> {
        // Process any messages that were queued before start was called
        while (this._messageQueue.length > 0) {
            const queuedMessage = this._messageQueue.shift()!;
            this.onmessage?.(queuedMessage.message, queuedMessage.extra);
        }
    }

    /**
     * Closes the connection.
     * 关闭连接。
     *
     * 行为：
     * 1. 断开与 _otherTransport 的连接。
     * 2. 级联调用对端的 close() 方法（如果对端还连接着）。
     * 3. 触发 onclose 回调。
     */
    async close(): Promise<void> {
        const other = this._otherTransport;
        this._otherTransport = undefined;
        await other?.close();
        this.onclose?.();
    }

    /**
     * Sends a message with optional auth info.
     * This is useful for testing authentication scenarios.
     * 发送 JSON-RPC 消息。
     *
     * @param message - 要发送的 JSON-RPC 消息对象。
     * @param options - 发送选项，包含 request ID 关联和鉴权信息。
     *
     * 逻辑：
     * 1. 检查是否已连接（_otherTransport 是否存在）。
     * 2. 如果对端已设置 onmessage 回调，直接同步调用它（模拟即时通信）。
     * 3. 如果对端尚未准备好（未设置 onmessage），将消息推入对端的 _messageQueue 等待处理。
     */
    async send(message: JSONRPCMessage, options?: { relatedRequestId?: RequestId; authInfo?: AuthInfo }): Promise<void> {
        if (!this._otherTransport) {
            throw new Error('Not connected');
        }

        if (this._otherTransport.onmessage) {
            this._otherTransport.onmessage(message, { authInfo: options?.authInfo });
        } else {
            this._otherTransport._messageQueue.push({ message, extra: { authInfo: options?.authInfo } });
        }
    }
}
