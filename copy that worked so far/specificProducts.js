import express from "express";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();

const router=express.Router();

const supabaseUrl= process.env.SUPABASE_URL;
const supabaseKey= process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase=createClient(supabaseUrl, supabaseKey);

router.get("/products/:title",async(req,res)=>{
    const title=decodeURIComponent(req.params.title);
    console.log("The title is: "+title);
    const tableName=getTableName(title);
    if(!tableName){
        return res.status(400).json({
            success: "false",
            message: "Invalid Category",
        });
    }
    try{
        const {data: categoryId, error: categoryError}= await supabase.from("Categories").select("Categories_id").eq("name", title).single();
        if(categoryError || !categoryId){
            return res.status(404).json({
                success: false,
                message: "Category not found",
            });
        }
        console.log("The category id now is: "+categoryId.Categories_id);
        const { data, error }= await supabase.from("Products").select("*").eq("Categories_id",categoryId.Categories_id);
        if(error){
            console.error(`Supabase error for Products`, error);
            return res.status(500).json({
                success: false,
                message: "Database error",
                error: error.message,
            });
        }
        res.json(data || []);
    }
    catch(err){
        console.error("There is an error: ",err);
        res.status(500).json({
            success: false,
            message: "Server Error", 
            error: err.message,
        });
    }
});
export default router;