import React, { Component } from "react";
class Control extends Component{
    constructor(props){
	super(props);
    	this.state = {
	    min: null,
	    max: null,
	    step: null,
    	    value: null,
	    labelName: null,
	    field: null,
	    changed: null
	}
	//this.
	
    }
    render(){
      return(
	<div style={{ display: "flex", flexDirection: "column" }}>
	  <p>{this.props.labelName}</p>
	  <input style={{ textAlign: "center" }} name={this.props.field} type="number" id={this.props.field} value={this.props.value} onChange={this.props.changed}/>

	  <input type="range" min={this.props.min} max={this.props.max} step={this.props.step} id={this.props.field} value={this.props.value} onChange={(evt) =>{this.props.changed(evt)}}/>
	</div>
      );
    }
}

export default Control;
