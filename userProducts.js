import express from "express";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();

const router=express.Router();
const supabaseUrl=process.env.SUPABASE_URL;
const supabaseKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase=createClient(supabaseUrl, supabaseKey);

router.get("/userProducts", async(req,res)=>{
    const {email}=req.query;
    if(!email){
        console.log("Email doesn't exist");
        return res.status(400).json({success: false, message: "Email is required"});//400 means bad request it tells the user that the request he/she did is invalid
    }
    let data, error;
    ({data, error} = await supabase.from("userProducts").select("product, totalweight, totalprice").eq("email",email));
    if(error){
        return res.status(500).json({success: "false", error: error.message});//that's because it's a server error
    }
    console.log("The needed information of the products of the user was retrieved successfully");
    res.status(200).json({success: true, products: data});
});

router.delete("/userProducts", async(req,res)=>{
    try{
    const {email}=req.query;
    if(!email){
        return res.status(400).json({success: false, error: "Email is required"});
    }
    const { error }=await supabase.from("userProducts").delete().eq("email",email);
    if(error){
        return res.status(500).json({success: false, error: error.message});
    }
    res.status(200).json({success:true, message: "Delete successful"});
    }
    catch(err){
        console.log("Server error: ",err);
        return res.status(500).json({success: false, error: "Server error"});
    }
});
export default router;