import processJSCode, {removeSourceMapIfAny} from "../../compilation/processJavaScriptCode"
import _ from "underscore"



var nativeEval = window.eval;
var nativeHTMLScriptElementTextDescriptor = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, "text");
var nativeFunction = window.Function
var nativeNodeTextContentDescriptor = Object.getOwnPropertyDescriptor(Node.prototype, "textContent")

export default class CodePreprocessor {
    constructor({babelPlugin}){
        this.documentReadyState = "loading"
        this.babelPlugin = babelPlugin
    }
    setOptions({onCodeProcessed, getNewFunctionCode, useValue, wrapPreprocessCode}){
        this.onCodeProcessed = onCodeProcessed
        this.getNewFunctionCode = getNewFunctionCode
        this.useValue = useValue

        var self = this;
        this.preprocessCode = function(code, options){
            return wrapPreprocessCode.apply(self, [code, options, processJSCode(self.babelPlugin)])
        }
    }
    enable(){
        var self = this;

        function processScriptTagCodeAssignment(code){
            var id = _.uniqueId();
            var filename = "ScriptTag" + id + ".js"
            var res = self.preprocessCode(code, {filename: filename})

            var fnName = "DynamicFunction" + id
            var smFilename = filename + ".map"
            var evalCode = res.code + "\n" +
                "\n//# sourceURL=" + filename +
                "\n//# sourceMappingURL=" + smFilename


            self.onCodeProcessed(filename, code, evalCode, res.map)

            return evalCode
        }


        window.eval = function(code){
            if (typeof self.useValue(code) !== "string") {
                return code
            }

            var id = _.uniqueId();
            var filename = "DynamicScript" + id + ".js"
            var res = self.preprocessCode(code, {filename: filename})

            var smFilename = filename + ".map"
            var evalCode = res.code + "\n//# sourceURL=" + filename +
                "\n//# sourceMappingURL=" + smFilename

            self.onCodeProcessed(filename, code, evalCode, res.map)

            return nativeEval(evalCode)
        };

        ["text", "textContent"].forEach(function handleTextAssignment(propertyName){
            Object.defineProperty(HTMLScriptElement.prototype, propertyName, {
                get: function (){
                    // text !== textContent, but close enough
                    return nativeHTMLScriptElementTextDescriptor.get.apply(this, arguments)
                },
                set: function(text){
                    text = processScriptTagCodeAssignment(text)
                    // text !== textContent, but close enough
                    return nativeHTMLScriptElementTextDescriptor.set.apply(this, [text])
                },
                configurable: true
            })
        })

        window.Function = function(code){
            var args = Array.prototype.slice.apply(arguments)
            var code = args.pop()
            code = removeSourceMapIfAny(code)
            var argsWithoutCode = args.slice()

            var id = _.uniqueId();
            var filename = "DynamicFunction" + id + ".js"

            var fnName = "DynamicFunction" + id
            var fnStart = "function " + fnName + "(" + argsWithoutCode.join(",") + "){";
            var fnEnd = "}"
            code = self.getNewFunctionCode(fnStart, code, fnEnd)

            var res = self.preprocessCode(code, {filename: filename})
            args.push(res.code)

            var smFilename = filename + ".map"
            var evalCode = res.code +
                "\n//# sourceURL=" + filename +
                "\n//# sourceMappingURL=" + smFilename

            // create script tag instead of eval to prevent strict mode from propagating
            // (I'm guessing if you call eval from code that's in strict mode  strict mode will
            // propagate to the eval'd code.)
            var script = document.createElement("script")
            script.innerHTML = evalCode
            document.body.appendChild(script)

            script.remove();

            self.onCodeProcessed(filename, code, evalCode, res.map, "Dynamic Function")

            return function(){
                return window[fnName].apply(this, arguments)
            }
        }

        window.Function.prototype = nativeFunction.prototype

        var self = this;
        window.f__getReadyState = function f__getReadyState(obj){
            if (obj === document){
                return self.documentReadyState;
            } else {
                return obj.readyState
            }
        }
        window.f__setDocumentReadyState = function f__setDocumentReadyState(value){
            self.documentReadyState = value
        }
    }
    disable(){
        window.eval = nativeEval
        Object.defineProperty(HTMLScriptElement.prototype, "text", nativeHTMLScriptElementTextDescriptor)
        // HTMLScriptElement doesn't normally have textcontent on own prototype, inherits the prop from Node
        Object.defineProperty(HTMLScriptElement.prototype, "textContent", nativeNodeTextContentDescriptor)

        window.Function = nativeFunction
    }
}