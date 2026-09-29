export type Profile={id:string;name:string;age:number;gender:string;city:string;job:string;bio:string;intent:string;interests:string[];photos:string[];prompt:string;paused:boolean;busy:boolean;likesYou:boolean;liked:boolean;passed:boolean;queuePosition:number;outgoing:number;incoming:number;activeCount:number;capacity:number};
export type Match={id:string;a:string;b:string;started:number;partner:Profile};
export type Message={id:string;match_id:string;sender:string;body:string;created:number};
export type DatePlan={id:string;match_id:string;sender:string;venue:string;occurs:string;status:string};
export type AppState={mode:"demo"|"live";viewer:Profile|null;profiles:Profile[];incoming:Profile[];outgoing:Profile[];matches:Match[];messages:Message[];dates:DatePlan[];plans:{capacity:boolean;queue:boolean};billingEnabled:boolean;transparency:Record<string,{connections:Profile[];queue:Profile[]}>};

