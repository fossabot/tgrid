//================================================================ 
/** @module tgrid.basic */
//================================================================
import { Pair } from "tstl/utility/Pair";
import { HashMap } from "tstl/container/HashMap";
import { ConditionVariable } from "tstl/thread/ConditionVariable";

import { Invoke } from "./Invoke";
import { Driver } from "./Driver";
import { RuntimeError } from "tstl/exception";

/**
 * The basic communicator.
 * 
 * The `CommunicatorBase` is an abstract class taking full charge of network communication. 
 * Protocolized communicators like {@link WebConnector} are realized by extending the 
 * `CommunicatorBase` class.
 * 
 * You want to make your own communicator using special protocol, then extends this 
 * `CommunicatorBase` class. Key features of RFC (Remote Function Call) are already 
 * implemented in the `CommunicatorBase`. Thus, only you've to is specializing your 
 * protocol using those methods with overridings:
 * 
 *   - Assign it
 *     - `provider_`: See {@link provider}
 *   - Use them
 *     - `replier`: Reference {@link Communicator.replyData}
 *     - `destructor`: Reference {@link Communicator.destructor}
 *   - Override them
 *     - `insepctor`: Reference {@link Communicator.inspectReady}
 *     - `sender`: Reference {@link Communicator.sendData}
 * 
 * @typeParam Provider Type of features provided for remote system.
 * @see {@link Communicator}: You prefer FP (Functional Programming), use it instead.
 * @wiki https://github.com/samchon/tgrid/wiki/Basic-Concepts
 * @author Jeongho Nam <http://samchon.org>
 */
export abstract class CommunicatorBase<Provider extends object = {}>
{
	/**
	 * @hidden
	 */
	private static SEQUENCE: number = 0;

	/**
	 * @hidden
	 */
	protected provider_: Provider;

	/**
	 * @hidden
	 */
	private promises_: HashMap<number, Pair<Function, Function>>;

	/**
	 * @hidden
	 */
	private join_cv_: ConditionVariable;

	/* ----------------------------------------------------------------
		CONSTRUCTORS
	---------------------------------------------------------------- */
	/**
	 * @hidden
	 */
	protected constructor(provider: Provider = null)
	{
		this.provider_ = provider;

		this.promises_ = new HashMap();
		this.join_cv_ = new ConditionVariable();
	}

	/**
	 * @hidden
	 */
	protected async destructor(error?: Error): Promise<void>
	{
		// REJECT UNRETURNED FUNCTIONS
		let rejectError: Error = error 
			? error 
			: new RuntimeError("Connection has been closed.");
		
		for (let entry of this.promises_)
		{
			let reject: Function = entry.second.second;
			reject(rejectError);
		}
		
		// CLEAR PROMISES
		this.promises_.clear();

		// RESOLVE JOINERS
		await this.join_cv_.notify_all();
	}

	/**
	 * @hidden
	 */
	protected abstract inspector(): Error;

	/**
	 * @hidden
	 */
	protected abstract sender(invoke: Invoke): void;

	/* ================================================================
		ACCESSORS
			- PROVIDER
			- DRIVER
			- JOINERS
	===================================================================
		PROVIDER
	---------------------------------------------------------------- */
	/**
	 * Current `Provider`.
	 * 
	 * An object providing features (functions & objects) for remote system. The remote 
	 * system would call the features (`Provider`) by using its `Driver<Controller>`.
	 */
	public get provider(): Provider
	{
		return this.provider_;
	}

	/* ----------------------------------------------------------------
		JOINERS
	---------------------------------------------------------------- */
	/**
	 * Join connection.
	 */
	public join(): Promise<void>;

	/**
	 * Join connection or timeout.
	 * 
	 * @param ms The maximum milliseconds for joining.
	 * @return Whether awaken by disconnection or timeout.
	 */
	public join(ms: number): Promise<boolean>;

	/**
	 * Join connection or time expiration.
	 * 
	 * @param at The maximum time point to join.
	 * @return Whether awaken by disconnection or time expiration.
	 */
	public join(at: Date): Promise<boolean>;

	public async join(param?: number | Date): Promise<void|boolean>
	{
		// IS JOINABLE ?
		let error: Error = this.inspector();
		if (error)
			throw error;

		// FUNCTION OVERLOADINGS
		if (param === undefined)
			await this.join_cv_.wait();
		else if (param instanceof Date)
			return await this.join_cv_.wait_until(param);
		else
			return await this.join_cv_.wait_for(param);
	}

	/* ----------------------------------------------------------------
		DRIVER
	---------------------------------------------------------------- */
	/**
	 * Get Driver for RFC (Remote Function Call).
	 * 
	 * The `Controller` is an interface who defines provided functions from the remote 
	 * system. The `Driver` is an object who makes to call remote functions, defined in 
	 * the `Controller` and provided by `Provider` in the remote system, possible.
	 * 
	 * In other words, calling a functions in the `Driver<Controller>`, it means to call 
	 * a matched function in the remote system's `Provider` object.
	 * 
	 *   - `Controller`: Definition only
	 *   - `Driver`: Remote Function Call
	 * 
	 * @typeParam Controller An interface for provided features (functions & objects) from the remote system (`Provider`).
	 * @return A Driver for the RFC.
	 */
	public getDriver<Controller extends object>(): Driver<Controller>
	{
		return new Proxy<Driver<Controller>>({} as Driver<Controller>,
		{
			get: ({}, name: string) =>
			{
				if (name === "then")
					return null;
				else
					return this._Proxy_func(name);
			}
		});
	}

	/**
	 * @hidden
	 */
	private _Proxy_func(name: string): Function
	{
		let func = (...params: any[]) => this._Call_function(name, ...params);

		return new Proxy(func, 
		{
			get: ({}, newName: string) =>
			{
				if (newName === "bind")
					return (thisArg: any) => func.bind(thisArg);

				return this._Proxy_func(`${name}.${newName}`);
			}
		});
	}

	/**
	 * @hidden
	 */
	private _Call_function(name: string, ...params: any[]): Promise<any>
	{
		return new Promise((resolve, reject) =>
		{
			// READY TO SEND ?
			let error: Error = this.inspector();
			if (error)
			{
				reject(error);
				return;
			}

			// CONSTRUCT INVOKE MESSAGE
			let invoke: Invoke.IFunction =
			{
				uid: ++CommunicatorBase.SEQUENCE,
				listener: name,
				parameters: params
			};

			// DO SEND WITH PROMISE
			this.promises_.emplace(invoke.uid, new Pair(resolve, reject));
			this.sender(invoke);
		});
	}

	/* ================================================================
		COMMUNICATORS
			- REPLIER
			- SENDER
	===================================================================
		REPLIER
	---------------------------------------------------------------- */
	/**
	 * @hidden
	 */
	protected replier(invoke: Invoke): void
	{
		if ((invoke as Invoke.IFunction).listener)
			this._Handle_function(invoke as Invoke.IFunction);
		else
			this._Handle_return(invoke as Invoke.IReturn);
	}

	/**
	 * @hidden
	 */
	private async _Handle_function(invoke: Invoke.IFunction): Promise<void>
	{
		let uid: number = invoke.uid;

		try
		{
			//----
			// FIND FUNCTION
			//----
			if (!this.provider_) // PROVIDER MUST BE
				throw new RuntimeError("Provider is not specified yet.");

			// let ret = await eval(`this.provider_.${invoke.listener}(...invoke.parameters)`);
			// this._Send_return(invoke.uid, true, ret);

			// FIND FUNCTION (WITH THIS-ARG)
			let func: Function = <any>this.provider_;
			let thisArg: any = undefined;

			let routes: string[] = invoke.listener.split(".");
			for (let name of routes)
			{
				thisArg = func;
				func = thisArg[name];
			}
			func = func.bind(thisArg);

			//----
			// RETURN VALUE
			//----
			// CALL FUNCTION
			let ret: any = await func(...invoke.parameters);
			this._Send_return(uid, true, ret);
		}
		catch (exp)
		{
			this._Send_return(uid, false, exp);
		}
	}

	/**
	 * @hidden
	 */
	private _Handle_return(invoke: Invoke.IReturn): void
	{
		// GET THE PROMISE OBJECT
		let it = this.promises_.find(invoke.uid);
		if (it.equals(this.promises_.end()))
			return;

		// RETURNS
		let func: Function = invoke.success 
			? it.second.first 
			: it.second.second;
		this.promises_.erase(it);
		
		func(invoke.value); 
	}

	/* ----------------------------------------------------------------
		SENDER
	---------------------------------------------------------------- */
	/**
	 * @hidden
	 */
	private _Send_return(uid: number, flag: boolean, val: any): void
	{
		// SPECIAL LOGIC FOR ERROR -> FOR CLEAR JSON ENCODING
		if (flag === false && val instanceof Error)
		{
			let obj = JSON.parse(JSON.stringify(val));
			obj.name = val.name;
			obj.message = val.message;

			val = obj;
		}

		// RETURNS
		let ret: Invoke.IReturn = {uid: uid, success: flag, value: val};
		this.sender(ret);
	}
}