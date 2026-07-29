import express from "express";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();

const router=express.Router();

const supabaseUrl=process.env.SUPABASE_URL;
const supabaseKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase=createClient(supabaseUrl, supabaseKey);

router.get("/item/:name_of_the_category/:title",async(req, res)=>{
    const name_of_the_category=decodeURIComponent(req.params.name_of_the_category);
    const title=decodeURIComponent(req.params.title);
    try{
        let data, error;
        console.log("We are in Item.js, The title is: "+title);
        
        ({ data, error }=await supabase.from("Products").select("*").eq("Product_name", title).single());
        if(error){
            return res.status(404).json({
                error: "Product not found",
            })
        }
        console.log("The data is: ",data);
        return res.json(data);
    }
    catch(err){
        return res.status(500).json({
            error: "Server Error",
        })
        console.error("Server Error",err);
    }
});
export default router;