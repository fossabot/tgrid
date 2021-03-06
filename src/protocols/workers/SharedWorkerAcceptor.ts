//================================================================ 
/** @module tgrid.protocols.workers */
//================================================================
import { CommunicatorBase } from "../../basic/CommunicatorBase";
import { IWorkerSystem } from "./internal/IWorkerSystem";
import { IAcceptor } from "../internal/IAcceptor";
import { Invoke } from "../../basic/Invoke";

import { DomainError } from "tstl";

/**
 * SharedWorker acceptor for client.
 *  - available only in Web Browser.
 * 
 * The `SharedWorkerAcceptor` is a communicator class communicating with the remote client 
 * ({@link SharedWorkerConnector}) using RFC (Remote Function Call). The `SharedAcceptor` 
 * objects are always created by the {@link SharedWorkerServer} class whenever a remote client
 * connects to its server.
 * 
 * To accept connection and start interaction with the remote client, call the {@link accept}() 
 * method with special `Provider`. Also, don't forget to closing the connection after your 
 * business has been completed.
 * 
 * @typeParam Provider Type of features provided for remote system.
 * @wiki https://github.com/samchon/tgrid/wiki/Workers
 * @author Jeongho Nam <http://samchon.org>
 */
export class SharedWorkerAcceptor<Provider extends object = {}>
	extends CommunicatorBase<Provider>
	implements IWorkerSystem, IAcceptor<SharedWorkerAcceptor.State, Provider>
{
	/**
	 * @hidden
	 */
	private port_: MessagePort;

	/**
	 * @hidden 
	 */
	private eraser_: ()=>void;

	/** 
	 * @hidden
	 */
	private state_: SharedWorkerAcceptor.State;

	/**
	 * @hidden
	 */
	private arguments_: string[];

	/* ----------------------------------------------------------------
		CONSTRUCTOR
	---------------------------------------------------------------- */
	/**
	 * @hidden
	 */
	private constructor(port: MessagePort, args: string[], eraser: ()=>void)
	{
		super();

		// ASSIGN MEMBER
		this.port_ = port;
		this.eraser_ = eraser;
		this.arguments_ = args;

		// PROPERTIES
		this.state_ = SharedWorkerAcceptor.State.NONE;
	}

	/**
	 * @inheritDoc
	 */
	public async close(): Promise<void>
	{
		// TEST CONDITION
		let error: Error = this.inspector();
		if (error)
			throw error;

		// CLOSE CONNECTION
		this.state_ = SharedWorkerAcceptor.State.CLOSING;
		await this._Close("CLOSE");
	}

	/**
	 * @hidden
	 */
	private async _Close(message: string): Promise<void>
	{
		// CALL HANDLERS
		this.eraser_();
		this.port_.postMessage(message);

		// DO CLOSE
		await this.destructor();
		this.port_.close();

		// WELL, IT MAY HARD TO SEE SUCH PROPERTIES
		this.state_ = SharedWorkerAcceptor.State.CLOSED;
	}

	/* ----------------------------------------------------------------
		ACCESSORS
	---------------------------------------------------------------- */
	/**
	 * @inheritDoc
	 */
	public get state(): SharedWorkerAcceptor.State
	{
		return this.state_;
	}

	/**
	 * Arguments delivered from the connector.
	 */
	public get arguments(): string[]
	{
		return this.arguments_;
	}

	/* ----------------------------------------------------------------
		HANDSHAKES
	---------------------------------------------------------------- */
	/**
	 * Accept connection.
	 * 
	 * Accept, permit the client's, connection to this server and start interaction.
	 * 
	 * @param provider An object providing features for remote system.
	 */
	public async accept(provider: Provider): Promise<void>
	{
		// TEST CONDITION
		if (this.state_ !== SharedWorkerAcceptor.State.NONE)
			throw new DomainError("You've already accepted (or rejected) the connection.");

		//----
		// ACCEPT CONNECTION
		//----
		this.state_ = SharedWorkerAcceptor.State.ACCEPTING;
		{
			// SET PROVIDER
			this.provider_ = provider;

			// PREPARE PORT
			this.port_.onmessage = this._Handle_message.bind(this);
			this.port_.start();

			// INFORM ACCEPTANCE
			this.port_.postMessage("ACCEPT");
		}
		this.state_ = SharedWorkerAcceptor.State.OPEN;
	}

	/**
	 * Reject connection.
	 * 
	 * Reject without acceptance, any interaction. The connection would be closed immediately.
	 */
	public async reject(): Promise<void>
	{
		// TEST CONDITION
		if (this.state_ !== SharedWorkerAcceptor.State.NONE)
			throw new DomainError("You've already accepted (or rejected) the connection.");

		//----
		// REJECT CONNECTION (CLOSE)
		//----
		this.state_ = SharedWorkerAcceptor.State.REJECTING;
		await this._Close("REJECT");
	}

	/* ----------------------------------------------------------------
		COMMUNICATOR
	---------------------------------------------------------------- */
	/**
	 * @hidden
	 */
	protected sender(invoke: Invoke): void
	{
		this.port_.postMessage(JSON.stringify(invoke));
	}
	
	/**
	 * @hidden
	 */
	protected inspector(): Error
	{
		return IAcceptor.inspect(this.state_);
	}

	/**
	 * @hidden
	 */
	private _Handle_message(evt: MessageEvent): void
	{
		if (evt.data === "CLOSE")
			this.close();
		else
			this.replier(JSON.parse(evt.data));
	}
}

export namespace SharedWorkerAcceptor
{
	export import State = IAcceptor.State;
}